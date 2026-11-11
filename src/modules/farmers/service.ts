import { Prisma } from "@/generated/prisma/client";
import type { FarmerProfile, MembershipStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/audit";
import { getOwnFarmerBankAccount } from "@/modules/banking/service";
import type { BankAccountView } from "@/modules/banking/views";
import { resolveInvite } from "@/modules/cooperatives/invites";
import { can, type Actor } from "@/modules/identity/policies";
import { farmerStatusEmail, type FarmerStatusEmailKind } from "@/modules/notifications/emails";
import { notify, officersOf, person } from "@/modules/notifications/service";
import { hasUnfinishedOrders } from "./orders-guard";
import { farmerProfileInput, type FarmerProfileInput } from "./schema";
import { toOfficerFarmer, toOwnFarmer, type OfficerFarmer, type OwnFarmer } from "./views";

export type { FarmerProfile };

// A farmer holds at most one PENDING or ACTIVE FARMER membership; the partial unique index
// membership_one_farmer_per_user is the last line under concurrency.
const HOLDING: MembershipStatus[] = ["PENDING", "ACTIVE"];

const REASON_MAX = 500;

// Crops in name order, for every profile read that builds a view.
const PROFILE_CROPS = {
  crops: { select: { id: true, name: true, nameKey: true }, orderBy: { nameKey: "asc" } },
} as const;

// Every id must be an active crop on the board's list. Duplicates collapse.
async function activeCropIds(cropIds: string[]): Promise<string[]> {
  const unique = [...new Set(cropIds)];
  if (unique.length === 0) return [];
  const found = await prisma.crop.count({ where: { id: { in: unique }, active: true } });
  if (found !== unique.length) throw new ValidationError("Crop is not active", "CROP_INACTIVE");
  return unique;
}

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
  const { cropIds, ...rest } = parsed.data;
  const crops = (await activeCropIds(cropIds)).map((id) => ({ id }));
  const fields = { cooperativeId, ...rest };

  let membershipId: string;
  try {
    membershipId = await prisma.$transaction(async (tx) => {
      const holding = await tx.membership.findFirst({
        where: { userId: user.userId, role: "FARMER", status: { in: HOLDING } },
        select: { id: true },
      });
      if (holding) throw new AlreadyInCooperative();

      // Removal sticks: a farmer removed (or rejected) by this cooperative cannot rejoin it.
      // Checked before the invite is consumed. Only LEFT reactivates the row, since
      // (userId, role, cooperativeId) is unique. Other cooperatives stay open to them.
      const previous = await tx.membership.findFirst({
        where: { userId: user.userId, role: "FARMER", cooperativeId },
        select: { id: true, status: true },
      });
      if (previous?.status === "REMOVED") {
        throw new ConflictError("Removed from this cooperative", "REMOVED_FROM_COOPERATIVE");
      }

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

      let id: string;
      if (previous) {
        const { count } = await tx.membership.updateMany({
          where: { id: previous.id, status: "LEFT" },
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
        create: { userId: user.userId, ...fields, crops: { connect: crops } },
        update: { ...fields, crops: { set: crops } },
      });
      const joiner = await tx.user.findUniqueOrThrow({ where: { id: user.userId }, select: { name: true } });
      await notify(tx, {
        kind: "FARMER_ASKED_TO_JOIN",
        subject: { type: "MEMBERSHIP", id },
        data: { name: joiner.name },
        to: await officersOf(tx, cooperativeId),
        exclude: user.userId,
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
  const profile = await prisma.farmerProfile.findUnique({
    where: { userId: user.userId },
    include: PROFILE_CROPS,
  });
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

// ---- Officer decisions and leaving ----

type Transition = {
  action: "farmer.approve" | "farmer.reject" | "farmer.remove" | "farmer.leave";
  from: MembershipStatus;
  to: MembershipStatus;
};

const APPROVE: Transition = { action: "farmer.approve", from: "PENDING", to: "ACTIVE" };
const REJECT: Transition = { action: "farmer.reject", from: "PENDING", to: "REMOVED" };
const REMOVE: Transition = { action: "farmer.remove", from: "ACTIVE", to: "REMOVED" };
const LEAVE: Transition = { action: "farmer.leave", from: "ACTIVE", to: "LEFT" };

function parseReason(reason: unknown): string {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed.length < 1 || trimmed.length > REASON_MAX) {
    throw new ValidationError(`A reason of 1 to ${REASON_MAX} characters is required`);
  }
  return trimmed;
}

// The cooperative comes from the membership row, never from the caller; can() then checks
// the actor belongs to it. Any other kind of membership is "not found" here.
async function loadFarmerMembership(membershipId: string) {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, role: "FARMER", cooperativeId: { not: null } },
    include: {
      cooperative: { select: { name: true, status: true } },
      user: { select: { email: true } },
    },
  });
  if (!membership || !membership.cooperativeId || !membership.cooperative) {
    throw new NotFoundError("MEMBERSHIP_NOT_FOUND");
  }
  return {
    ...membership,
    cooperativeId: membership.cooperativeId,
    cooperative: membership.cooperative,
  };
}

// Compare-and-set: of two concurrent decisions only one moves the row.
async function applyTransition(
  actor: Actor,
  membership: { id: string; cooperativeId: string },
  transition: Transition,
  extra: { approvedAt?: Date; reason?: string },
): Promise<void> {
  const { count } = await prisma.membership.updateMany({
    where: { id: membership.id, status: transition.from, role: "FARMER" },
    data: {
      status: transition.to,
      ...(extra.approvedAt ? { approvedAt: extra.approvedAt } : {}),
    },
  });
  if (count === 0) throw new ConflictError("Illegal transition", "ILLEGAL_TRANSITION");
  await recordAudit({
    actorId: actor.userId,
    action: transition.action,
    entity: "membership",
    entityId: membership.id,
    meta: {
      membershipId: membership.id,
      cooperativeId: membership.cooperativeId,
      from: transition.from,
      to: transition.to,
      ...(extra.reason === undefined ? {} : { reason: extra.reason }),
    },
  });
}

function logFarmerEmailFailure(
  membershipId: string,
  kind: FarmerStatusEmailKind,
  err: unknown,
): void {
  // Never log the recipient, the html or the reason.
  console.error("farmer status email failed", {
    membershipId,
    kind,
    error:
      err instanceof Error ? { name: err.name, message: err.message } : "non-Error thrown",
  });
}

// The decision is already recorded; a failed email must not undo it.
async function emailFarmer(
  membership: { id: string; user: { email: string }; cooperative: { name: string } },
  kind: FarmerStatusEmailKind,
  reason?: string,
): Promise<void> {
  try {
    const { subject, html } = farmerStatusEmail(kind, {
      cooperativeName: membership.cooperative.name,
      reason,
    });
    await sendEmail({ to: membership.user.email, subject, html });
  } catch (err) {
    logFarmerEmailFailure(membership.id, kind, err);
  }
}

// Tells the farmer how their membership was decided. It belongs to the person, not to a role:
// a farmer who was just removed may hold no role at all, and sees it when they take one up.
async function tellFarmer(
  actor: Actor,
  kind: "MEMBERSHIP_APPROVED" | "MEMBERSHIP_REJECTED" | "MEMBERSHIP_REMOVED",
  membership: { id: string; userId: string; cooperative: { name: string } },
): Promise<void> {
  await notify(prisma, {
    kind,
    subject: { type: "MEMBERSHIP", id: membership.id },
    data: { cooperative: membership.cooperative.name },
    to: [person(membership.userId)],
    exclude: actor.userId,
  });
}

export async function approveFarmer(
  actor: Actor,
  membershipId: string,
  now: Date = new Date(),
): Promise<void> {
  const membership = await loadFarmerMembership(membershipId);
  if (!can(actor, "farmer:approve", { cooperativeId: membership.cooperativeId })) {
    throw new ForbiddenError();
  }
  // A suspended (or not yet verified) cooperative cannot accept farmers.
  if (membership.cooperative.status !== "VERIFIED") {
    throw new ConflictError("Cooperative is not verified", "COOPERATIVE_NOT_VERIFIED");
  }
  await applyTransition(actor, membership, APPROVE, { approvedAt: now });
  await emailFarmer(membership, "approved");
  // Last, after the audit row and the email: the decision is saved by here.
  await tellFarmer(actor, "MEMBERSHIP_APPROVED", membership);
}

export async function rejectFarmer(
  actor: Actor,
  membershipId: string,
  reason: string,
): Promise<void> {
  const membership = await loadFarmerMembership(membershipId);
  if (!can(actor, "farmer:approve", { cooperativeId: membership.cooperativeId })) {
    throw new ForbiddenError();
  }
  const trimmed = parseReason(reason);
  await applyTransition(actor, membership, REJECT, { reason: trimmed });
  await emailFarmer(membership, "rejected", trimmed);
  await tellFarmer(actor, "MEMBERSHIP_REJECTED", membership);
}

export async function removeFarmer(
  actor: Actor,
  membershipId: string,
  reason: string,
): Promise<void> {
  const membership = await loadFarmerMembership(membershipId);
  if (!can(actor, "farmer:remove", { cooperativeId: membership.cooperativeId })) {
    throw new ForbiddenError();
  }
  const trimmed = parseReason(reason);
  if (await hasUnfinishedOrders(membership.userId)) {
    throw new ConflictError("Farmer has unfinished orders", "UNFINISHED_ORDERS");
  }
  await applyTransition(actor, membership, REMOVE, { reason: trimmed });
  await emailFarmer(membership, "removed", trimmed);
  await tellFarmer(actor, "MEMBERSHIP_REMOVED", membership);
}

// Self-scoped: acts only on the actor's own ACTIVE farmer membership. Rows are kept.
export async function leaveCooperative(actor: Actor): Promise<void> {
  if (
    !can(actor, "farmer:leave", {
      ownerUserId: actor.userId,
      cooperativeId: actor.cooperativeId ?? undefined,
    })
  ) {
    throw new ForbiddenError();
  }
  const membership = await prisma.membership.findFirst({
    where: {
      userId: actor.userId,
      role: "FARMER",
      cooperativeId: actor.cooperativeId,
      status: "ACTIVE",
    },
    select: { id: true, cooperativeId: true },
  });
  if (!membership || !membership.cooperativeId) {
    throw new ConflictError("Illegal transition", "ILLEGAL_TRANSITION");
  }
  if (await hasUnfinishedOrders(actor.userId)) {
    throw new ConflictError("Farmer has unfinished orders", "UNFINISHED_ORDERS");
  }
  await applyTransition(
    actor,
    { id: membership.id, cooperativeId: membership.cooperativeId },
    LEAVE,
    {},
  );
  const farmerUser = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true } });
  await notify(prisma, {
    kind: "FARMER_LEFT",
    subject: { type: "MEMBERSHIP", id: membership.id },
    data: { name: farmerUser.name },
    to: await officersOf(prisma, membership.cooperativeId),
    exclude: actor.userId,
  });
}

// An officer's list row: the profile view plus the membership id the decisions act on.
export type OfficerFarmerRow = OfficerFarmer & { membershipId: string };

// Filters on the membership, never on FarmerProfile.cooperativeId, which goes stale
// once a farmer leaves and joins elsewhere.
async function listFarmersWithStatus(
  actor: Actor,
  cooperativeId: string,
  status: MembershipStatus,
): Promise<OfficerFarmerRow[]> {
  if (!can(actor, "farmer:approve", { cooperativeId })) throw new ForbiddenError();
  const memberships = await prisma.membership.findMany({
    where: { cooperativeId, role: "FARMER", status },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, phoneConfirmed: true } },
    },
  });
  const profiles = await prisma.farmerProfile.findMany({
    where: { userId: { in: memberships.map((m) => m.userId) } },
    include: PROFILE_CROPS,
  });
  const byUser = new Map(profiles.map((p) => [p.userId, p]));
  const rows: OfficerFarmerRow[] = [];
  for (const membership of memberships) {
    const profile = byUser.get(membership.userId);
    if (!profile) continue;
    rows.push({
      ...toOfficerFarmer({ ...profile, cooperativeId }, membership.user),
      membershipId: membership.id,
    });
  }
  return rows;
}

export function listPendingFarmers(actor: Actor, cooperativeId: string) {
  return listFarmersWithStatus(actor, cooperativeId, "PENDING");
}

export function listActiveFarmers(actor: Actor, cooperativeId: string) {
  return listFarmersWithStatus(actor, cooperativeId, "ACTIVE");
}

// The farmer replaces the crops on their own profile, chosen from the board's list.
export async function updateOwnCrops(actor: Actor, cropIds: string[]): Promise<OwnFarmer> {
  if (!can(actor, "farmer:profile", { ownerUserId: actor.userId })) throw new ForbiddenError();
  if (!Array.isArray(cropIds) || cropIds.length > 20 || cropIds.some((id) => typeof id !== "string")) {
    throw new ValidationError("Choose at most 20 crops", "INVALID_CROPS");
  }
  const crops = (await activeCropIds(cropIds)).map((id) => ({ id }));
  const existing = await prisma.farmerProfile.findUnique({ where: { userId: actor.userId } });
  if (!existing) throw new NotFoundError("PROFILE_NOT_FOUND");
  const profile = await prisma.farmerProfile.update({
    where: { userId: actor.userId },
    data: { crops: { set: crops } },
    include: PROFILE_CROPS,
  });
  await recordAudit({
    actorId: actor.userId,
    action: "farmer.crops",
    entity: "farmer_profile",
    entityId: profile.id,
    meta: { cropIds: crops.map((c) => c.id) },
  });
  return toOwnFarmer(profile);
}

export { pendingFarmersSummary } from "./summaries";
