import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { Membership, MembershipStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/modules/audit/audit";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import type { Role } from "./policies";

export type { Membership };

const ROLES = [
  "FARMER",
  "OFFICER",
  "BUYER",
  "ADMIN",
  "BOARD_ADMIN",
] as const satisfies readonly Role[];

const STATUSES = [
  "PENDING",
  "ACTIVE",
  "REMOVED",
  "LEFT",
] as const satisfies readonly MembershipStatus[];

const membershipInput = z
  .object({
    userId: z.string().min(1),
    role: z.enum(ROLES),
    cooperativeId: z.string().min(1).optional(),
    status: z.enum(STATUSES).default("ACTIVE"),
  })
  .superRefine((value, ctx) => {
    const needsCooperative =
      value.role === "FARMER" || value.role === "OFFICER";
    if (needsCooperative && value.cooperativeId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["cooperativeId"],
        message: `${value.role} requires a cooperativeId`,
      });
    }
    if (!needsCooperative && value.cooperativeId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["cooperativeId"],
        message: `${value.role} must not have a cooperativeId`,
      });
    }
  });

// Internal bootstrap used by tests and seeds. It takes no Actor because no Phase 0
// Action covers granting memberships; actor-checked callers arrive in Phase 1.
export async function addMembership(input: {
  userId: string;
  role: Role;
  cooperativeId?: string;
  status?: MembershipStatus;
}): Promise<Membership> {
  const parsed = membershipInput.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  const { userId, role, cooperativeId, status } = parsed.data;
  try {
    const membership = await prisma.membership.create({
      data: { userId, role, cooperativeId: cooperativeId ?? null, status },
    });
    await recordAudit({
      actorId: null,
      action: "membership.grant",
      entity: "membership",
      entityId: membership.id,
      meta: { role, status },
    });
    return membership;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ConflictError(
        "This membership already exists or conflicts with an existing one",
      );
    }
    throw error;
  }
}

// Self-scoped lookup that precedes an Actor: it reads only the given user's own
// ACTIVE memberships, so there is no Actor to check yet.
export async function listMemberships(userId: string): Promise<Membership[]> {
  return prisma.membership.findMany({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
}

// Self-scoped lookup with no Actor (the user may have no ACTIVE membership yet): the role
// and status of each of the given user's own memberships, for the header links only.
export async function listMembershipStates(
  userId: string,
): Promise<Array<{ role: Role; status: MembershipStatus }>> {
  return prisma.membership.findMany({
    where: { userId },
    select: { role: true, status: true },
    orderBy: { createdAt: "asc" },
  });
}

// Self-scoped lookup that precedes an Actor (it is how the active role is chosen).
// Ownership check: a missing membership and another user's membership look the
// same to the caller, so ids cannot be probed.
export async function getOwnedMembership(
  userId: string,
  membershipId: string,
): Promise<Membership> {
  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
  });
  if (!membership || membership.userId !== userId) {
    throw new ForbiddenError("NOT_YOUR_MEMBERSHIP");
  }
  return membership;
}

// Buyer sign-up: self-onboarding with no Actor (the caller has no buyer membership yet), scoped
// to the caller's own userId, like joinViaLink. Better Auth requires a verified email before
// sign-in; this checks it again. There is no SMS, so phone confirmation falls back silently to
// the email check and phoneConfirmed stays false for admins to see (spec 6.2).
export async function becomeBuyer(user: { userId: string }): Promise<{ membershipId: string }> {
  const account = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { emailVerified: true },
  });
  if (!account?.emailVerified) throw new ForbiddenError("EMAIL_NOT_VERIFIED");
  const existing = await prisma.membership.findFirst({
    where: { userId: user.userId, role: "BUYER", cooperativeId: null },
  });
  if (existing?.status === "ACTIVE") return { membershipId: existing.id };
  // Only a buyer who left comes back by themselves; one an admin removed stays removed.
  if (existing?.status === "REMOVED") throw new ConflictError("Removed as a buyer", "REMOVED_AS_BUYER");
  try {
    const membership = await prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.membership.update({ where: { id: existing.id }, data: { status: "ACTIVE" } })
        : await tx.membership.create({ data: { userId: user.userId, role: "BUYER", status: "ACTIVE" } });
      await recordAudit(
        {
          actorId: user.userId,
          action: "buyer.join",
          entity: "membership",
          entityId: row.id,
          meta: { membershipId: row.id },
        },
        tx,
      );
      return row;
    });
    return { membershipId: membership.id };
  } catch (error) {
    // A concurrent call created it first: return that one.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const row = await prisma.membership.findFirstOrThrow({
        where: { userId: user.userId, role: "BUYER", cooperativeId: null },
      });
      return { membershipId: row.id };
    }
    throw error;
  }
}

// Whether the user is an ACTIVE farmer or officer of the cooperative. Server-internal, no Actor:
// the marketplace uses it to stop people making offers on their own cooperative's lots.
export async function holdsCooperativeRole(userId: string, cooperativeId: string): Promise<boolean> {
  const count = await prisma.membership.count({
    where: { userId, cooperativeId, status: "ACTIVE", role: { in: ["FARMER", "OFFICER"] } },
  });
  return count > 0;
}
