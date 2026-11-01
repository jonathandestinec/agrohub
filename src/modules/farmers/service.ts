import { Prisma } from "@/generated/prisma/client";
import type { FarmerProfile, MembershipStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/audit";
import { getOwnFarmerBankAccount } from "@/modules/banking/service";
import type { BankAccountView } from "@/modules/banking/views";
import { resolveInvite } from "@/modules/cooperatives/invites";
import { farmerProfileInput, type FarmerProfileInput } from "./schema";
import { toOwnFarmer, type OwnFarmer } from "./views";

export type { FarmerProfile };

// A farmer holds at most one PENDING or ACTIVE FARMER membership; the partial unique index
// membership_one_farmer_per_user is the last line under concurrency.
const HOLDING: MembershipStatus[] = ["PENDING", "ACTIVE"];
const ENDED: MembershipStatus[] = ["LEFT", "REMOVED"];

class AlreadyInCooperative extends ConflictError {
  constructor() {
    super("Already a member of a cooperative", "ALREADY_IN_COOPERATIVE");
  }
}

function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Self-onboarding: the caller has no ACTIVE membership yet (a PENDING farmer has no Actor),
// so there is no Actor; scoped to the caller's own userId. The invite token is the
// cooperative's permission.
export async function joinViaLink(
  user: { userId: string },
  token: string,
  profile: FarmerProfileInput,
  now: Date,
): Promise<{ membershipId: string }> {
  const parsed = farmerProfileInput.safeParse(profile);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  const invite = await resolveInvite(token, now);
  if (invite.email !== null) {
    const account = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { email: true },
    });
    if (!account || !sameEmail(account.email, invite.email)) {
      throw new ForbiddenError("INVITE_EMAIL_MISMATCH");
    }
  }
  const { cooperativeId } = invite;
  const fields = { cooperativeId, ...parsed.data };

  let membershipId: string;
  try {
    membershipId = await prisma.$transaction(async (tx) => {
      const holding = await tx.membership.findFirst({
        where: { userId: user.userId, role: "FARMER", status: { in: HOLDING } },
        select: { id: true },
      });
      if (holding) throw new AlreadyInCooperative();

      if (invite.email !== null) {
        // Only email-bound invites are single-use. Shareable links (email null) are reused
        // by every farmer and never get usedAt. The condition stops two concurrent joins
        // from both using one invite.
        const { count } = await tx.inviteLink.updateMany({
          where: { token, email: { not: null }, usedAt: null, revokedAt: null },
          data: { usedAt: now },
        });
        if (count === 0) throw new NotFoundError("INVITE_INVALID");
      }

      // Rejoining the same cooperative after LEFT or REMOVED reuses the row, since
      // (userId, role, cooperativeId) is unique.
      const previous = await tx.membership.findFirst({
        where: { userId: user.userId, role: "FARMER", cooperativeId },
        select: { id: true },
      });
      let id: string;
      if (previous) {
        const { count } = await tx.membership.updateMany({
          where: { id: previous.id, status: { in: ENDED } },
          data: { status: "PENDING", approvedAt: null },
        });
        if (count === 0) throw new AlreadyInCooperative();
        id = previous.id;
      } else {
        const created = await tx.membership.create({
          data: { userId: user.userId, role: "FARMER", cooperativeId, status: "PENDING" },
        });
        id = created.id;
      }

      // One profile per user: a returning farmer's row moves to this cooperative.
      await tx.farmerProfile.upsert({
        where: { userId: user.userId },
        create: { userId: user.userId, ...fields },
        update: fields,
      });
      return id;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // Lost a race with a concurrent join by the same user.
      throw new AlreadyInCooperative();
    }
    throw error;
  }

  await recordAudit({
    actorId: user.userId,
    action: "farmer.join",
    entity: "membership",
    entityId: membershipId,
    meta: { membershipId, cooperativeId },
  });
  return { membershipId };
}

export type OwnFarmerOverview = {
  membership: {
    id: string;
    status: MembershipStatus;
    cooperativeId: string;
    cooperativeName: string;
  } | null;
  profile: OwnFarmer | null;
  bank: BankAccountView | null;
};

// Self-scoped lookup that precedes an Actor (a PENDING farmer has none): reads only the
// caller's own farmer membership, profile and payout account.
export async function getOwnFarmerOverview(
  user: { userId: string },
  now: Date = new Date(),
): Promise<OwnFarmerOverview> {
  const membership =
    (await prisma.membership.findFirst({
      where: { userId: user.userId, role: "FARMER", status: { in: HOLDING } },
      include: { cooperative: { select: { name: true } } },
    })) ??
    (await prisma.membership.findFirst({
      where: { userId: user.userId, role: "FARMER" },
      include: { cooperative: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }));
  const profile = await prisma.farmerProfile.findUnique({ where: { userId: user.userId } });
  const bank = await getOwnFarmerBankAccount(user, now);
  return {
    membership:
      membership && membership.cooperativeId && membership.cooperative
        ? {
            id: membership.id,
            status: membership.status,
            cooperativeId: membership.cooperativeId,
            cooperativeName: membership.cooperative.name,
          }
        : null,
    profile: profile ? toOwnFarmer(profile) : null,
    bank,
  };
}
