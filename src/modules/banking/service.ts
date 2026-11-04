import { randomBytes } from "node:crypto";
import type { BankChangeRequest, BankOwnerType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  createRecipient,
  listBanks,
  resolveAccount,
  validateBankInput,
  type BankInput,
} from "@/lib/paystack";
import { recordAudit } from "@/modules/audit/audit";
import { can, type Actor } from "@/modules/identity/policies";
import {
  bankChangeAdminAlertEmail,
  bankChangeConfirmEmail,
} from "@/modules/notifications/emails";
import { listActiveAdminEmails } from "@/modules/notifications/recipients";
import { namesMatch } from "./names";
import { toBankAccountView, type BankAccountView } from "./views";

export type { BankOwnerType };
export type BankOwner = { type: BankOwnerType; id: string };

const HOUR_MS = 3_600_000;
// A confirmed change waits this long, so a hijacked account cannot redirect money at once.
const CHANGE_DELAY_MS = 48 * HOUR_MS;
const CONFIRM_TTL_MS = 24 * HOUR_MS;

function invalidChange(): NotFoundError {
  return new NotFoundError("BANK_CHANGE_INVALID");
}

type StoredAccount = {
  name: string;
  recipientCode: string | null;
  accountName: string | null;
  bankName: string | null;
};

// A FARMER owner id is the FarmerProfile id. Farmer profiles keep no bank name (only the
// recipient code and the resolved account name), so bankName is always null for them.
async function loadOwner(owner: BankOwner): Promise<StoredAccount> {
  if (owner.type === "FARMER") {
    const profile = await prisma.farmerProfile.findUnique({
      where: { id: owner.id },
      select: { recipientCode: true, accountName: true, user: { select: { name: true } } },
    });
    if (!profile) throw new NotFoundError("FARMER_PROFILE_NOT_FOUND");
    return {
      name: profile.user.name,
      recipientCode: profile.recipientCode,
      accountName: profile.accountName,
      bankName: null,
    };
  }
  const cooperative = await prisma.cooperative.findUnique({
    where: { id: owner.id },
    select: { name: true, recipientCode: true, accountName: true, bankName: true },
  });
  if (!cooperative) throw new NotFoundError("COOPERATIVE_NOT_FOUND");
  return cooperative;
}

function logEmailFailure(kind: string, requestId: string, err: unknown): void {
  // Never log the recipient address or the html (it carries the confirmation link).
  console.error("bank change email failed", {
    kind,
    requestId,
    error:
      err instanceof Error ? { name: err.name, message: err.message } : "non-Error thrown",
  });
}

export async function setCooperativeBankAccount(
  actor: Actor,
  cooperativeId: string,
  input: BankInput,
  now: Date = new Date(),
): Promise<{ accountName: string; pending: boolean }> {
  if (!can(actor, "bank:change", { cooperativeId })) throw new ForbiddenError();
  const cooperative = await prisma.cooperative.findUnique({
    where: { id: cooperativeId },
    select: { name: true },
  });
  if (!cooperative) throw new NotFoundError("COOPERATIVE_NOT_FOUND");
  return applyBankAccount(
    { type: "COOPERATIVE", id: cooperativeId },
    cooperative.name,
    actor.userId,
    input,
    now,
  );
}

/**
 * Module-private: callers must have authorised the change for this owner first.
 * Exported for the self-scoped farmer path; nothing outside this module should call it.
 * The account number is used only in the Paystack calls below and is never stored.
 */
export async function applyBankAccount(
  owner: BankOwner,
  registeredName: string,
  requestedBy: string,
  input: BankInput,
  now: Date = new Date(),
): Promise<{ accountName: string; pending: boolean }> {
  validateBankInput(input);
  const bank = (await listBanks()).find((b) => b.code === input.bankCode);
  if (!bank) throw new ValidationError("Unknown bank", "UNKNOWN_BANK");
  const { accountName } = await resolveAccount(input);
  if (!namesMatch(registeredName, accountName)) {
    throw new ValidationError(
      "The account name does not match the registered name",
      "ACCOUNT_NAME_MISMATCH",
    );
  }
  const current = await loadOwner(owner);
  const { recipientCode } = await createRecipient({ ...input, name: accountName });

  if (current.recipientCode === null) {
    // First account: nothing to protect yet, so it applies at once. The condition makes
    // a concurrent first set fall through to the change-request path.
    const { count } =
      owner.type === "COOPERATIVE"
        ? await prisma.cooperative.updateMany({
            where: { id: owner.id, recipientCode: null },
            data: { recipientCode, accountName, bankName: bank.name },
          })
        : await prisma.farmerProfile.updateMany({
            where: { id: owner.id, recipientCode: null },
            data: { recipientCode, accountName },
          });
    if (count === 1) {
      await recordAudit({
        actorId: requestedBy,
        action: "bank.set",
        entity: owner.type === "COOPERATIVE" ? "cooperative" : "farmer_profile",
        entityId: owner.id,
        meta: { ownerType: owner.type },
      });
      return { accountName, pending: false };
    }
  }

  const confirmToken = randomBytes(32).toString("base64url");
  const request = await prisma.$transaction(async (tx) => {
    // A newer request replaces any older one that was never confirmed.
    await tx.bankChangeRequest.updateMany({
      where: {
        ownerType: owner.type,
        ownerId: owner.id,
        confirmedAt: null,
        cancelledAt: null,
      },
      data: { cancelledAt: now },
    });
    return tx.bankChangeRequest.create({
      data: {
        ownerType: owner.type,
        ownerId: owner.id,
        newRecipientCode: recipientCode,
        newAccountName: accountName,
        newBankName: bank.name,
        requestedBy,
        confirmToken,
        createdAt: now,
      },
    });
  });
  await recordAudit({
    actorId: requestedBy,
    action: "bank.change.requested",
    entity: "bank_change_request",
    entityId: request.id,
    meta: { ownerType: owner.type, ownerId: owner.id },
  });
  await sendConfirmation(request, current.name);
  return { accountName, pending: true };
}

// Runs after the request is stored, so a failed email is logged, never thrown: the
// requester can submit again, which cancels this request.
async function sendConfirmation(request: BankChangeRequest, ownerName: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: request.requestedBy },
      select: { email: true },
    });
    if (!user) return;
    const link = new URL("/bank/confirm", env.BETTER_AUTH_URL);
    link.searchParams.set("token", request.confirmToken);
    const { subject, html } = bankChangeConfirmEmail({ ownerName, link: link.toString() });
    await sendEmail({ to: user.email, subject, html });
  } catch (err) {
    logEmailFailure("confirm", request.id, err);
  }
}

// No Actor: the single-use token emailed to the requester is the proof. Used from the
// signed-out /bank/confirm page.
export async function confirmBankChange(
  token: string,
  now: Date = new Date(),
): Promise<{ effectiveAt: Date }> {
  if (typeof token !== "string" || token.length === 0) throw invalidChange();
  const effectiveAt = new Date(now.getTime() + CHANGE_DELAY_MS);
  const { count } = await prisma.bankChangeRequest.updateMany({
    where: {
      confirmToken: token,
      confirmedAt: null,
      cancelledAt: null,
      createdAt: { gt: new Date(now.getTime() - CONFIRM_TTL_MS) },
    },
    data: { confirmedAt: now, effectiveAt },
  });
  if (count === 0) throw invalidChange();
  const request = await prisma.bankChangeRequest.findUniqueOrThrow({
    where: { confirmToken: token },
  });
  await recordAudit({
    actorId: request.requestedBy,
    action: "bank.change.confirmed",
    entity: "bank_change_request",
    entityId: request.id,
    meta: {
      ownerType: request.ownerType,
      ownerId: request.ownerId,
      effectiveAt: effectiveAt.toISOString(),
    },
  });
  await alertAdmins(request, effectiveAt);
  return { effectiveAt };
}

async function alertAdmins(request: BankChangeRequest, effectiveAt: Date): Promise<void> {
  try {
    const owner = await loadOwner({ type: request.ownerType, id: request.ownerId });
    const admins = await listActiveAdminEmails();
    const { subject, html } = bankChangeAdminAlertEmail({
      ownerName: owner.name,
      accountName: request.newAccountName,
      bankName: request.newBankName,
      effectiveAt,
    });
    const results = await Promise.allSettled(
      admins.map((to) => sendEmail({ to, subject, html })),
    );
    for (const result of results) {
      if (result.status === "rejected") logEmailFailure("admin-alert", request.id, result.reason);
    }
  } catch (err) {
    logEmailFailure("admin-alert", request.id, err);
  }
}

async function newestEffective(owner: BankOwner, at: Date): Promise<BankChangeRequest | null> {
  return prisma.bankChangeRequest.findFirst({
    where: {
      ownerType: owner.type,
      ownerId: owner.id,
      confirmedAt: { not: null },
      cancelledAt: null,
      effectiveAt: { lte: at },
    },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
  });
}

// System function, no Actor: Phase 5 payouts call it to pick the account to pay. A change
// counts only once its 48 hours have passed, whether or not the apply job has run yet.
export async function effectiveRecipientCode(
  owner: BankOwner,
  at: Date,
): Promise<string | null> {
  const request = await newestEffective(owner, at);
  if (request) return request.newRecipientCode;
  return (await loadOwner(owner)).recipientCode;
}

// System function, no Actor: the bank-change-apply job. Copies the newest due change onto
// each owner. Safe to run twice: only requests with no appliedAt are claimed, and the claim
// is a conditional update inside the same transaction as the copy.
export async function applyDueBankChanges(now: Date = new Date()): Promise<{ applied: number }> {
  const due = await prisma.bankChangeRequest.findMany({
    where: {
      confirmedAt: { not: null },
      cancelledAt: null,
      appliedAt: null,
      effectiveAt: { lte: now },
    },
    orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }],
  });
  const byOwner = new Map<string, BankChangeRequest[]>();
  for (const request of due) {
    const key = `${request.ownerType}:${request.ownerId}`;
    byOwner.set(key, [...(byOwner.get(key) ?? []), request]);
  }
  let applied = 0;
  for (const requests of byOwner.values()) {
    const newest = requests[requests.length - 1];
    const claimed = await prisma.$transaction(async (tx) => {
      const { count } = await tx.bankChangeRequest.updateMany({
        where: { id: { in: requests.map((r) => r.id) }, appliedAt: null },
        data: { appliedAt: now },
      });
      if (count === 0) return false;
      if (newest.ownerType === "COOPERATIVE") {
        await tx.cooperative.update({
          where: { id: newest.ownerId },
          data: {
            recipientCode: newest.newRecipientCode,
            accountName: newest.newAccountName,
            bankName: newest.newBankName,
          },
        });
      } else {
        await tx.farmerProfile.update({
          where: { id: newest.ownerId },
          data: {
            recipientCode: newest.newRecipientCode,
            accountName: newest.newAccountName,
          },
        });
      }
      return true;
    });
    if (!claimed) continue;
    applied += 1;
    await recordAudit({
      actorId: null,
      action: "bank.change.applied",
      entity: "bank_change_request",
      entityId: newest.id,
      meta: { ownerType: newest.ownerType, ownerId: newest.ownerId },
    });
  }
  return { applied };
}

export async function getCooperativeBankAccount(
  actor: Actor,
  cooperativeId: string,
  now: Date = new Date(),
): Promise<BankAccountView> {
  if (!can(actor, "cooperative:read", { cooperativeId })) throw new ForbiddenError();
  return bankAccountView({ type: "COOPERATIVE", id: cooperativeId }, now);
}

async function bankAccountView(owner: BankOwner, now: Date): Promise<BankAccountView> {
  const stored = await loadOwner(owner);
  const effective = await newestEffective(owner, now);
  const current = effective
    ? {
        bankName: owner.type === "COOPERATIVE" ? effective.newBankName : null,
        accountName: effective.newAccountName,
      }
    : { bankName: stored.bankName, accountName: stored.accountName };
  const pending = await prisma.bankChangeRequest.findFirst({
    where: openChangeWhere(owner, now),
    orderBy: { createdAt: "desc" },
    select: { confirmedAt: true, effectiveAt: true },
  });
  return toBankAccountView(current, pending);
}

// A change still in flight: awaiting its email confirmation (within 24 hours), or confirmed
// and inside its 48-hour wait.
function openChangeWhere(owner: BankOwner, now: Date): Prisma.BankChangeRequestWhereInput {
  return {
    ownerType: owner.type,
    ownerId: owner.id,
    cancelledAt: null,
    appliedAt: null,
    OR: [
      { confirmedAt: null, createdAt: { gt: new Date(now.getTime() - CONFIRM_TTL_MS) } },
      { confirmedAt: { not: null }, effectiveAt: { gt: now } },
    ],
  };
}

export { namesMatch };

// System function, no Actor: the name-change service calls it for a subject it has already
// authorised. A person's payout account is their farmer profile's; with no profile there is
// none. Returns the current account name and whether a bank change is in flight.
export async function payoutAccountFor(
  subject: { type: "USER" | "COOPERATIVE"; id: string },
  now: Date,
): Promise<{ accountName: string | null; changeOpen: boolean }> {
  let owner: BankOwner;
  if (subject.type === "USER") {
    const profile = await prisma.farmerProfile.findUnique({
      where: { userId: subject.id },
      select: { id: true },
    });
    if (!profile) return { accountName: null, changeOpen: false };
    owner = { type: "FARMER", id: profile.id };
  } else {
    owner = { type: "COOPERATIVE", id: subject.id };
  }
  const view = await bankAccountView(owner, now);
  return { accountName: view.accountName, changeOpen: view.change !== null };
}

// The farmer's own profile, if they hold a PENDING or ACTIVE FARMER membership. A farmer
// who has left keeps the profile row but may not change its payout account.
async function ownFarmerProfile(userId: string): Promise<{ id: string; name: string } | null> {
  const profile = await prisma.farmerProfile.findUnique({
    where: { userId },
    select: { id: true, cooperativeId: true, user: { select: { name: true } } },
  });
  if (!profile) return null;
  const membership = await prisma.membership.findFirst({
    where: {
      userId,
      role: "FARMER",
      cooperativeId: profile.cooperativeId,
      status: { in: ["PENDING", "ACTIVE"] },
    },
    select: { id: true },
  });
  return membership ? { id: profile.id, name: profile.user.name } : null;
}

// Self-onboarding: a PENDING farmer has no Actor yet, so there is no Actor; scoped to the
// caller's own userId and their own FarmerProfile. The registered name is User.name.
// The first account applies at once; later changes take the 48-hour confirmed path.
export async function setOwnFarmerBankAccount(
  user: { userId: string },
  input: BankInput,
  now: Date = new Date(),
): Promise<{ accountName: string; pending: boolean }> {
  const profile = await ownFarmerProfile(user.userId);
  if (!profile) throw new ForbiddenError();
  return applyBankAccount(
    { type: "FARMER", id: profile.id },
    profile.name,
    user.userId,
    input,
    now,
  );
}

// Self-scoped read for /farmer and /join: the caller's own payout account, or null when
// they have no farmer profile. Shows the account name and change state, never the code.
export async function getOwnFarmerBankAccount(
  user: { userId: string },
  now: Date = new Date(),
): Promise<BankAccountView | null> {
  const profile = await prisma.farmerProfile.findUnique({
    where: { userId: user.userId },
    select: { id: true },
  });
  if (!profile) return null;
  return bankAccountView({ type: "FARMER", id: profile.id }, now);
}

// ---- Live name lookup on the bank forms ----

// What the bank holds for an account, before anything is saved: the name, and whether it
// matches the registered name the save will check. Nothing is stored and no recipient is
// created; the save re-checks everything on the server.
export type AccountPreview = { accountName: string; matches: boolean; registeredName: string };

async function preview(registeredName: string, input: BankInput): Promise<AccountPreview> {
  validateBankInput(input);
  const { accountName } = await resolveAccount(input);
  return { accountName, matches: namesMatch(registeredName, accountName), registeredName };
}

// Self-scoped like setOwnFarmerBankAccount: a PENDING farmer has no Actor yet.
export async function previewOwnFarmerBankAccount(
  user: { userId: string },
  input: BankInput,
): Promise<AccountPreview> {
  const profile = await ownFarmerProfile(user.userId);
  if (!profile) throw new ForbiddenError();
  return preview(profile.name, input);
}

export async function previewCooperativeBankAccount(
  actor: Actor,
  cooperativeId: string,
  input: BankInput,
): Promise<AccountPreview> {
  if (!can(actor, "bank:change", { cooperativeId })) throw new ForbiddenError();
  const cooperative = await prisma.cooperative.findUnique({
    where: { id: cooperativeId },
    select: { name: true },
  });
  if (!cooperative) throw new NotFoundError("COOPERATIVE_NOT_FOUND");
  return preview(cooperative.name, input);
}
