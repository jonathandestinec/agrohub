import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { Membership } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
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

const membershipInput = z
  .object({
    userId: z.string().min(1),
    role: z.enum(ROLES),
    cooperativeId: z.string().min(1).optional(),
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
}): Promise<Membership> {
  const parsed = membershipInput.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  const { userId, role, cooperativeId } = parsed.data;
  try {
    return await prisma.membership.create({
      data: { userId, role, cooperativeId: cooperativeId ?? null },
    });
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

// Reads the caller's own memberships.
export async function listMemberships(userId: string): Promise<Membership[]> {
  return prisma.membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
}

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
