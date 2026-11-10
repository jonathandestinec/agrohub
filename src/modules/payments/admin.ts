import type { PayoutRecipient, PayoutStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { koboFromDb } from "@/lib/money";
import { recordAudit } from "@/modules/audit/audit";
import { effectiveRecipientCode } from "@/modules/banking/service";
import { can, type Actor } from "@/modules/identity/policies";
import { payoutGateway, type PayoutGateway } from "./payout-gateway";
import { sendDuePayouts, settleAttempt } from "./sending";

// A transfer Paystack still holds after this long is shown to admins.
export const STALE_TRANSFER_HOURS = 72;

// What admins see of a payout with a problem: never the recipient code or account details.
export type AdminPayout = {
  id: string;
  orderId: string;
  orderReference: string;
  recipientType: PayoutRecipient;
  recipientName: string;
  amountKobo: number;
  status: PayoutStatus;
  attempts: number;
  lastFailure: string | null;
  sentAt: string | null;
  createdAt: string;
};

function assertManage(actor: Actor): void {
  if (!can(actor, "payout:manage")) throw new ForbiddenError();
}

async function namesOf(rows: Array<{ recipientType: PayoutRecipient; recipientId: string }>): Promise<Map<string, string>> {
  const coopIds = rows.filter((r) => r.recipientType === "COOPERATIVE").map((r) => r.recipientId);
  const userIds = rows.filter((r) => r.recipientType === "FARMER").map((r) => r.recipientId);
  const [coops, users] = await Promise.all([
    prisma.cooperative.findMany({ where: { id: { in: coopIds } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
  ]);
  return new Map([...coops, ...users].map((r) => [r.id, r.name]));
}

/** Payouts that need an admin: failed, blocked, refused for balance, or awaiting Paystack for over 3 days. Oldest first. */
export async function listPayoutIssues(actor: Actor, now: Date = new Date()): Promise<AdminPayout[]> {
  assertManage(actor);
  const staleBefore = new Date(now.getTime() - STALE_TRANSFER_HOURS * 3_600_000);
  const rows = await prisma.payout.findMany({
    where: {
      OR: [
        { status: { in: ["FAILED", "BLOCKED"] } },
        { status: "QUEUED", balanceRefusals: { gt: 0 } },
        { status: "SENT", attempts: { some: { status: "SENT", createdAt: { lt: staleBefore } } } },
      ],
    },
    include: { attempts: { orderBy: { attempt: "desc" } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  const names = await namesOf(rows);
  return rows.map((row) => {
    const last = row.attempts[0] ?? null;
    return {
      id: row.id,
      orderId: row.orderId,
      orderReference: row.orderId.slice(-8).toUpperCase(),
      recipientType: row.recipientType,
      recipientName: names.get(row.recipientId) ?? "",
      amountKobo: koboFromDb(row.amountKobo),
      status: row.status,
      attempts: row.attempts.length,
      lastFailure: last && last.status !== "SENT" && last.status !== "SUCCEEDED" ? (last.failureReason ?? last.status) : null,
      sentAt: last && last.status === "SENT" ? last.createdAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

// The owner's account now, for a payout whose account an admin re-points or unblocks.
async function currentAccount(payout: { recipientType: PayoutRecipient; recipientId: string }, now: Date) {
  if (payout.recipientType === "COOPERATIVE") {
    return { bankOwnerId: payout.recipientId, recipientCode: await effectiveRecipientCode({ type: "COOPERATIVE", id: payout.recipientId }, now) };
  }
  const profile = await prisma.farmerProfile.findUnique({ where: { userId: payout.recipientId }, select: { id: true } });
  if (!profile) return { bankOwnerId: null, recipientCode: null };
  return { bankOwnerId: profile.id, recipientCode: await effectiveRecipientCode({ type: "FARMER", id: profile.id }, now) };
}

/**
 * An admin sends a failed payout again, as a new attempt with a new transfer reference. Only
 * after Paystack confirms the last attempt failed or was reversed: one it still holds is never
 * sent twice. With useCurrentAccount the payout is re-pointed to the owner's effective account
 * now (audited); otherwise the account fixed at release is used.
 */
export async function retryPayout(
  actor: Actor,
  payoutId: string,
  options: { useCurrentAccount: boolean },
  now: Date = new Date(),
  gateway: PayoutGateway = payoutGateway(),
): Promise<void> {
  assertManage(actor);
  const payout = await prisma.payout.findUnique({ where: { id: payoutId }, include: { attempts: { orderBy: { attempt: "desc" }, take: 1 } } });
  if (!payout) throw new NotFoundError("PAYOUT_NOT_FOUND");
  if (payout.status !== "FAILED") throw new ConflictError("Only a failed payout can be retried", "PAYOUT_NOT_FAILED");
  const last = payout.attempts[0];
  if (last && last.failureReason !== "NO_FUNDS") {
    const checked = await gateway.check(last.transferReference);
    if (checked === "PENDING") throw new ConflictError("Paystack still holds the last transfer", "PAYOUT_STILL_PENDING");
    if (checked === "PAID") {
      // Paystack paid it after all: record that, and send nothing.
      await settleAttempt(last.transferReference, "PAID", now);
      throw new ConflictError("Paystack paid this transfer", "PAYOUT_PAID_AT_PAYSTACK");
    }
  }
  let account: { bankOwnerId: string | null; recipientCode: string | null } | null = null;
  if (options.useCurrentAccount) {
    account = await currentAccount(payout, now);
    if (!account.recipientCode) throw new ConflictError("The recipient has no payout account", "NO_RECIPIENT");
  }
  const { count } = await prisma.payout.updateMany({
    where: { id: payoutId, status: "FAILED" },
    data: { status: "QUEUED", sendableAt: now, ...(account ?? {}) },
  });
  if (count === 0) throw new ConflictError("Only a failed payout can be retried", "PAYOUT_NOT_FAILED");
  await recordAudit({
    actorId: actor.userId,
    action: "payout.retry",
    entity: "payout",
    entityId: payoutId,
    meta: { payoutId, useCurrentAccount: options.useCurrentAccount },
  });
  await sendDuePayouts({ orderId: payout.orderId, now, gateway });
}

/**
 * An admin queues a blocked payout once its owner has a payout account. The admin's check
 * stands in for the membership rule that blocked it; the money still goes only to the owner.
 */
export async function unblockPayout(actor: Actor, payoutId: string, now: Date = new Date(), gateway: PayoutGateway = payoutGateway()): Promise<void> {
  assertManage(actor);
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) throw new NotFoundError("PAYOUT_NOT_FOUND");
  if (payout.status !== "BLOCKED") throw new ConflictError("Only a blocked payout can be unblocked", "PAYOUT_NOT_BLOCKED");
  const account = await currentAccount(payout, now);
  if (!account.recipientCode) throw new ConflictError("The recipient has no payout account", "NO_RECIPIENT");
  const { count } = await prisma.payout.updateMany({
    where: { id: payoutId, status: "BLOCKED" },
    data: { status: "QUEUED", ...account, sendableAt: payout.sendableAt > now ? payout.sendableAt : now },
  });
  if (count === 0) throw new ConflictError("Only a blocked payout can be unblocked", "PAYOUT_NOT_BLOCKED");
  await recordAudit({ actorId: actor.userId, action: "payout.unblock", entity: "payout", entityId: payoutId, meta: { payoutId } });
  await sendDuePayouts({ orderId: payout.orderId, now, gateway });
}

// What an admin's action left the payout as: its status, and for a failed or reversed last
// attempt the reason stored on it (Paystack's own text is never stored).
export type PayoutOutcome = { status: PayoutStatus; failureReason: string | null };

export async function payoutOutcome(actor: Actor, payoutId: string): Promise<PayoutOutcome> {
  assertManage(actor);
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    select: { status: true, attempts: { orderBy: { attempt: "desc" }, take: 1, select: { status: true, failureReason: true } } },
  });
  if (!payout) throw new NotFoundError("PAYOUT_NOT_FOUND");
  const last = payout.attempts[0];
  const failed = last && (last.status === "FAILED" || last.status === "REVERSED");
  return { status: payout.status, failureReason: failed ? (last.failureReason ?? last.status) : null };
}
