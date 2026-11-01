import { randomBytes } from "node:crypto";
import type { BankChangeRequest, BankOwnerType } from "@/generated/prisma/client";
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
import { namesMatch } from "./names";
import { toBankAccountView, type BankAccountView } from "./views";

export type { BankOwnerType };
export type BankOwner = { type: BankOwnerType; id: string };

const HOUR_MS = 3_600_000;
// A confirmed change waits this long, so a hijacked account cannot redirect money at once.
const CHANGE_DELAY_MS = 48 * HOUR_MS;
const CONFIRM_TTL_MS = 24 * HOUR_MS;

function notImplementedForFarmer(): never {
  // Task 8 adds FarmerProfile and completes the FARMER branches.
  throw new Error("NOT_IMPLEMENTED_UNTIL_TASK_8");
}

function invalidChange(): NotFoundError {
  return new NotFoundError("BANK_CHANGE_INVALID");
}

type StoredAccount = {
  name: string;
  recipientCode: string | null;
  accountName: string | null;
  bankName: string | null;
};

async function loadOwner(owner: BankOwner): Promise<StoredAccount> {
  if (owner.type === "FARMER") notImplementedForFarmer();
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
 * Exported only so Task 8's self-scoped farmer function in this module family can reuse it.
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
    const { count } = await prisma.cooperative.updateMany({
      where: { id: owner.id, recipientCode: null },
      data: { recipientCode, accountName, bankName: bank.name },
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
// officer can submit again, which cancels this request.
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
    const admins = await prisma.membership.findMany({
      where: { role: "ADMIN", status: "ACTIVE" },
      select: { user: { select: { email: true } } },
      distinct: ["userId"],
    });
    const { subject, html } = bankChangeAdminAlertEmail({
      ownerName: owner.name,
      accountName: request.newAccountName,
      bankName: request.newBankName,
      effectiveAt,
    });
    const results = await Promise.allSettled(
      admins.map((admin) => sendEmail({ to: admin.user.email, subject, html })),
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
  if (owner.type === "FARMER") notImplementedForFarmer();
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
  let farmerPending = false;
  for (const requests of byOwner.values()) {
    const newest = requests[requests.length - 1];
    if (newest.ownerType === "FARMER") {
      farmerPending = true;
      continue;
    }
    const claimed = await prisma.$transaction(async (tx) => {
      const { count } = await tx.bankChangeRequest.updateMany({
        where: { id: { in: requests.map((r) => r.id) }, appliedAt: null },
        data: { appliedAt: now },
      });
      if (count === 0) return false;
      await tx.cooperative.update({
        where: { id: newest.ownerId },
        data: {
          recipientCode: newest.newRecipientCode,
          accountName: newest.newAccountName,
          bankName: newest.newBankName,
        },
      });
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
  if (farmerPending) notImplementedForFarmer();
  return { applied };
}

export async function getCooperativeBankAccount(
  actor: Actor,
  cooperativeId: string,
  now: Date = new Date(),
): Promise<BankAccountView> {
  if (!can(actor, "cooperative:read", { cooperativeId })) throw new ForbiddenError();
  const owner: BankOwner = { type: "COOPERATIVE", id: cooperativeId };
  const stored = await loadOwner(owner);
  const effective = await newestEffective(owner, now);
  const current = effective
    ? { bankName: effective.newBankName, accountName: effective.newAccountName }
    : { bankName: stored.bankName, accountName: stored.accountName };
  const pending = await prisma.bankChangeRequest.findFirst({
    where: {
      ownerType: owner.type,
      ownerId: owner.id,
      cancelledAt: null,
      appliedAt: null,
      OR: [
        { confirmedAt: null, createdAt: { gt: new Date(now.getTime() - CONFIRM_TTL_MS) } },
        { confirmedAt: { not: null }, effectiveAt: { gt: now } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { confirmedAt: true, effectiveAt: true },
  });
  return toBankAccountView(current, pending);
}
