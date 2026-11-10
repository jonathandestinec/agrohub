import type { PayoutRecipient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { koboFromDb } from "@/lib/money";
import { recordAudit } from "@/modules/audit/audit";
import type { PayoutAlertKind } from "@/modules/notifications/emails";
import { alertAdmins } from "./alerts";
import { postLedger } from "./ledger";
import { payoutGateway, type PayoutGateway } from "./payout-gateway";

// After this many refusals for a low Paystack balance, admins are told.
const BALANCE_REFUSALS_ALERT = 3;
const RETRY_LATER_MS = 24 * 3_600_000;

export type SettleResult = "SETTLED" | "ALREADY_SETTLED" | "UNKNOWN_TRANSFER";

function payableAccount(recipientType: PayoutRecipient) {
  return recipientType === "COOPERATIVE" ? ("COOPERATIVE_PAYABLE" as const) : ("FARMER_PAYABLE" as const);
}

/**
 * System function: the transfer webhook (after its checks), the sender and reconciliation call
 * it with what Paystack says of one transfer. Only an attempt still SENT changes, so news that
 * arrives twice changes nothing. A success pays the payout with its ledger group; a failure or
 * reversal fails it and alerts admins, and only an admin retries it. A reversal of a transfer
 * already paid puts the amount back on the payable side.
 */
export async function settleAttempt(
  transferReference: string,
  outcome: "PAID" | "FAILED" | "REVERSED",
  now: Date = new Date(),
  failureReason: string | null = null,
): Promise<SettleResult> {
  const attempt = await prisma.payoutAttempt.findUnique({ where: { transferReference }, include: { payout: true } });
  if (!attempt) return "UNKNOWN_TRANSFER";
  const payout = attempt.payout;
  const amountKobo = koboFromDb(payout.amountKobo);
  const account = payableAccount(payout.recipientType);
  let alert: PayoutAlertKind | null = null;
  const result = await prisma.$transaction(async (tx): Promise<SettleResult> => {
    if (outcome === "REVERSED" && attempt.status === "SUCCEEDED") {
      // Paystack took back a transfer it had completed: the payout is owed again.
      const { count } = await tx.payoutAttempt.updateMany({
        where: { id: attempt.id, status: "SUCCEEDED" },
        data: { status: "REVERSED", settledAt: now },
      });
      if (count === 0) return "ALREADY_SETTLED";
      await tx.payout.updateMany({ where: { id: payout.id, status: "PAID" }, data: { status: "FAILED", paidAt: null } });
      await postLedger(tx, {
        orderId: payout.orderId,
        kind: "payout.reversed",
        lines: [
          { account: "PAYSTACK_BALANCE", amountKobo },
          { account, amountKobo: -amountKobo, recipientRef: payout.recipientId },
        ],
      });
      await recordAudit(
        { actorId: null, action: "payout.reversed", entity: "payout", entityId: payout.id, meta: { payoutId: payout.id, attempt: attempt.attempt } },
        tx,
      );
      alert = "FAILED";
      return "SETTLED";
    }
    const { count } = await tx.payoutAttempt.updateMany({
      where: { id: attempt.id, status: "SENT" },
      data: { status: outcome === "PAID" ? "SUCCEEDED" : outcome, settledAt: now, ...(failureReason ? { failureReason } : {}) },
    });
    if (count === 0) {
      if (outcome === "PAID" && (attempt.status === "FAILED" || attempt.status === "REVERSED") && attempt.failureReason !== "NO_FUNDS") {
        // Paystack now says a transfer taken as failed went through. If it is still the payout's
        // last attempt and the payout is still FAILED (not retried), it is simply paid; if it
        // was retried, the recipient may be paid twice and an admin must look.
        alert = "RECONCILIATION";
        await recordAudit(
          { actorId: null, action: "payout.late_success", entity: "payout", entityId: payout.id, meta: { payoutId: payout.id, attempt: attempt.attempt } },
          tx,
        );
        const latest = await tx.payoutAttempt.aggregate({ where: { payoutId: payout.id }, _max: { attempt: true } });
        if (latest._max.attempt !== attempt.attempt) return "ALREADY_SETTLED";
        const repaired = await tx.payoutAttempt.updateMany({
          where: { id: attempt.id, status: attempt.status },
          data: { status: "SUCCEEDED", settledAt: now },
        });
        const paid = await tx.payout.updateMany({ where: { id: payout.id, status: "FAILED" }, data: { status: "PAID", paidAt: now } });
        if (repaired.count === 0 || paid.count === 0) return "ALREADY_SETTLED";
        await postLedger(tx, {
          orderId: payout.orderId,
          kind: "payout.paid",
          lines: [
            { account, amountKobo, recipientRef: payout.recipientId },
            { account: "PAYSTACK_BALANCE", amountKobo: -amountKobo },
          ],
        });
        return "SETTLED";
      }
      return "ALREADY_SETTLED";
    }
    if (outcome === "PAID") {
      const paid = await tx.payout.updateMany({ where: { id: payout.id, status: "SENT" }, data: { status: "PAID", paidAt: now } });
      if (paid.count === 1) {
        await postLedger(tx, {
          orderId: payout.orderId,
          kind: "payout.paid",
          lines: [
            { account, amountKobo, recipientRef: payout.recipientId },
            { account: "PAYSTACK_BALANCE", amountKobo: -amountKobo },
          ],
        });
        await recordAudit(
          { actorId: null, action: "payout.paid", entity: "payout", entityId: payout.id, meta: { payoutId: payout.id, amountKobo } },
          tx,
        );
      }
      return "SETTLED";
    }
    await tx.payout.updateMany({ where: { id: payout.id, status: "SENT" }, data: { status: "FAILED" } });
    await recordAudit(
      { actorId: null, action: "payout.failed", entity: "payout", entityId: payout.id, meta: { payoutId: payout.id, reason: failureReason ?? outcome } },
      tx,
    );
    alert = "FAILED";
    return "SETTLED";
  });
  if (alert) await alertAdmins({ kind: alert, orderId: payout.orderId, amountKobo, recipientType: payout.recipientType });
  return result;
}

type Claimed = {
  payoutId: string;
  orderId: string;
  transferReference: string;
  amountKobo: number;
  recipientCode: string;
  recipientType: PayoutRecipient;
};

// QUEUED -> SENT and a new attempt in one transaction, so two senders at once claim it once.
async function claim(payoutId: string, now: Date): Promise<Claimed | null> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.payout.updateMany({
      where: { id: payoutId, status: "QUEUED", sendableAt: { lte: now }, recipientCode: { not: null } },
      data: { status: "SENT" },
    });
    if (count === 0) return null;
    const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
    const last = await tx.payoutAttempt.aggregate({ where: { payoutId }, _max: { attempt: true } });
    const attempt = (last._max.attempt ?? 0) + 1;
    const transferReference = `${payout.reference}-${attempt}`;
    await tx.payoutAttempt.create({ data: { payoutId, attempt, transferReference, status: "SENT", createdAt: now } });
    return {
      payoutId,
      orderId: payout.orderId,
      transferReference,
      amountKobo: koboFromDb(payout.amountKobo),
      recipientCode: payout.recipientCode as string,
      recipientType: payout.recipientType,
    };
  });
}

// Paystack refused for a low balance, so nothing left AgroHub. The payout goes back to the
// queue for tomorrow; the third refusal tells admins.
async function deferForBalance(claimed: Claimed, now: Date): Promise<void> {
  const refusals = await prisma.$transaction(async (tx) => {
    await tx.payoutAttempt.update({
      where: { transferReference: claimed.transferReference },
      data: { status: "FAILED", failureReason: "NO_FUNDS", settledAt: now },
    });
    const payout = await tx.payout.update({
      where: { id: claimed.payoutId },
      data: { status: "QUEUED", sendableAt: new Date(now.getTime() + RETRY_LATER_MS), balanceRefusals: { increment: 1 } },
    });
    await recordAudit(
      {
        actorId: null,
        action: "payout.no_funds",
        entity: "payout",
        entityId: claimed.payoutId,
        meta: { payoutId: claimed.payoutId, refusals: payout.balanceRefusals },
      },
      tx,
    );
    return payout.balanceRefusals;
  });
  if (refusals === BALANCE_REFUSALS_ALERT) {
    await alertAdmins({ kind: "NO_FUNDS", orderId: claimed.orderId, amountKobo: claimed.amountKobo, recipientType: claimed.recipientType });
  }
}

/**
 * System function, no Actor: the release (after commit), the daily payouts job and admin
 * retries call it. Sends every QUEUED payout whose funds have cleared (sendableAt), optionally
 * of one order. Each payout is claimed QUEUED -> SENT with a new attempt and its own transfer
 * reference before Paystack is called, so two runs at once send it once. A transfer Paystack
 * holds (pending, OTP, or an answer that never came) stays SENT and is never sent again: only
 * what Paystack says later, by webhook or by reconciliation's check, moves it.
 */
export async function sendDuePayouts(
  options: { orderId?: string; now?: Date; gateway?: PayoutGateway } = {},
): Promise<{ sent: number; deferred: number }> {
  const now = options.now ?? new Date();
  const gateway = options.gateway ?? payoutGateway();
  const due = await prisma.payout.findMany({
    where: {
      status: "QUEUED",
      sendableAt: { lte: now },
      recipientCode: { not: null },
      ...(options.orderId ? { orderId: options.orderId } : {}),
    },
    orderBy: [{ sendableAt: "asc" }, { id: "asc" }],
    select: { id: true },
    take: 500,
  });
  let sent = 0;
  let deferred = 0;
  for (const { id } of due) {
    const claimed = await claim(id, now);
    if (!claimed) continue;
    let answer: Awaited<ReturnType<PayoutGateway["send"]>>;
    try {
      answer = await gateway.send({
        reference: claimed.transferReference,
        amountKobo: claimed.amountKobo,
        recipientCode: claimed.recipientCode,
        reason: `AgroHub order ${claimed.orderId.slice(-8).toUpperCase()}`,
      });
    } catch (error) {
      // An unexpected answer: Paystack may hold the transfer, so it stays SENT for reconciliation.
      console.error("payout send failed", { payoutId: claimed.payoutId, error: error instanceof Error ? error.name : "unknown" });
      sent += 1;
      continue;
    }
    if (answer.transferCode) {
      await prisma.payoutAttempt.update({ where: { transferReference: claimed.transferReference }, data: { transferCode: answer.transferCode } });
    }
    if (answer.outcome === "NO_FUNDS") {
      await deferForBalance(claimed, now);
      deferred += 1;
    } else if (answer.outcome === "PAID") {
      await settleAttempt(claimed.transferReference, "PAID", now);
      sent += 1;
    } else if (answer.outcome === "FAILED") {
      await settleAttempt(claimed.transferReference, "FAILED", now, answer.failureReason);
    } else {
      await recordAudit({ actorId: null, action: "payout.sent", entity: "payout", entityId: claimed.payoutId, meta: { payoutId: claimed.payoutId } });
      sent += 1;
    }
  }
  return { sent, deferred };
}

/**
 * System function: a transfer webhook, after its signature check. What the event says is
 * checked once more against Paystack's verify endpoint before anything changes, as
 * charge.success is.
 */
export async function settleTransferEvent(
  transferReference: string,
  now: Date = new Date(),
  gateway: PayoutGateway = payoutGateway(),
): Promise<string> {
  const known = await prisma.payoutAttempt.findUnique({ where: { transferReference }, select: { id: true } });
  if (!known) return "UNKNOWN_TRANSFER";
  const checked = await gateway.check(transferReference);
  if (checked === "PENDING") return "STILL_PENDING";
  const result = await settleAttempt(transferReference, checked, now, checked === "FAILED" ? "FAILED" : null);
  return result === "SETTLED" ? (checked === "PAID" ? "PAID" : "FAILED") : result;
}
