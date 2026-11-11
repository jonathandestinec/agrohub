import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ConflictError, UnavailableError } from "@/lib/errors";
import { koboFromDb } from "@/lib/money";
import { refundTransaction } from "@/lib/paystack";
import { recordAudit } from "@/modules/audit/audit";
import { alertAdmins, notifyRefundSent } from "./alerts";
import { postLedger } from "./ledger";

const CLAIM = "claim:";

/**
 * System function: sends one Refund to Paystack, once. The row is claimed first (a placeholder
 * Paystack id), so two calls at once never both send. If Paystack cannot be reached the claim is
 * released and the refund stays PENDING for reconciliation, which checks Paystack before retrying.
 */
export async function issueRefund(refundId: string): Promise<void> {
  const claim = `${CLAIM}${randomUUID()}`;
  const { count } = await prisma.refund.updateMany({
    where: { id: refundId, status: "PENDING", paystackRefundId: null },
    data: { paystackRefundId: claim },
  });
  if (count === 0) return;
  const refund = await prisma.refund.findUniqueOrThrow({
    where: { id: refundId },
    include: { order: { include: { payments: { where: { status: "SUCCEEDED" }, select: { reference: true } } } } },
  });
  const payment = refund.order.payments[0];
  if (!payment) throw new Error("REFUND_WITHOUT_PAYMENT");
  const amountKobo = koboFromDb(refund.amountKobo);
  try {
    const sent = await refundTransaction({ reference: payment.reference, amountKobo });
    await prisma.refund.updateMany({ where: { id: refundId, paystackRefundId: claim }, data: { paystackRefundId: sent.refundId } });
    await recordAudit({
      actorId: null,
      action: "refund.sent",
      entity: "refund",
      entityId: refundId,
      meta: { refundId, orderId: refund.orderId, amountKobo },
    });
  } catch (error) {
    await prisma.refund.updateMany({ where: { id: refundId, paystackRefundId: claim }, data: { paystackRefundId: null } });
    await recordAudit({
      actorId: null,
      action: "refund.call_failed",
      entity: "refund",
      entityId: refundId,
      meta: { refundId, orderId: refund.orderId, error: error instanceof UnavailableError ? error.code : "ERROR" },
    });
    // Paystack down or refusing: the refund stays PENDING and is sent again on the next
    // confirmation of this payment (a webhook redelivery, or reconciliation in Phase 5b).
    if (!(error instanceof UnavailableError) && !(error instanceof ConflictError)) throw error;
  }
}

/** System function: sends every refund of an order that is still waiting to reach Paystack. */
export async function resendPendingRefunds(orderId: string): Promise<void> {
  const pending = await prisma.refund.findMany({
    where: { orderId, status: "PENDING", paystackRefundId: null },
    select: { id: true },
  });
  for (const refund of pending) await issueRefund(refund.id);
}

// The refund a Paystack refund event is about: by the Paystack refund id when the event carries
// one we stored, else by the transaction reference (our payment) and the amount, among refunds
// not yet settled. The second path also covers a refund whose id was never stored because the
// refund call timed out after Paystack created it.
async function findRefund(event: { refundId?: string; transactionReference?: string; amountKobo?: number }) {
  if (event.refundId) {
    const byId = await prisma.refund.findUnique({ where: { paystackRefundId: event.refundId } });
    if (byId) return byId;
  }
  if (!event.transactionReference) return null;
  const payment = await prisma.payment.findUnique({ where: { reference: event.transactionReference }, select: { orderId: true } });
  if (!payment) return null;
  const candidates = await prisma.refund.findMany({ where: { orderId: payment.orderId, status: "PENDING" } });
  const matching =
    event.amountKobo === undefined ? candidates : candidates.filter((r) => koboFromDb(r.amountKobo) === event.amountKobo);
  return matching.length === 1 ? matching[0] : null;
}

/** System function: Paystack's refund.processed or refund.failed webhook. Safe to run twice. */
export async function settleRefund(
  event: { refundId?: string; transactionReference?: string; amountKobo?: number },
  outcome: "PROCESSED" | "FAILED",
  now: Date = new Date(),
): Promise<"SETTLED" | "UNKNOWN_REFUND" | "ALREADY_SETTLED"> {
  const refund = await findRefund(event);
  if (!refund) return "UNKNOWN_REFUND";
  const amountKobo = koboFromDb(refund.amountKobo);
  const result = await prisma.$transaction(async (tx) => {
    const { count } = await tx.refund.updateMany({
      where: { id: refund.id, status: "PENDING" },
      data: { status: outcome, processedAt: outcome === "PROCESSED" ? now : null },
    });
    if (count === 0) return "ALREADY_SETTLED" as const;
    if (outcome === "PROCESSED") {
      await postLedger(tx, {
        orderId: refund.orderId,
        kind: "refund.processed",
        lines: [
          { account: "REFUND_PAYABLE", amountKobo },
          { account: "PAYSTACK_BALANCE", amountKobo: -amountKobo },
        ],
      });
      // Only on the branch where this call settled the refund, so a replay adds nothing.
      await notifyRefundSent(tx, refund);
    }
    await recordAudit(
      {
        actorId: null,
        action: outcome === "PROCESSED" ? "refund.processed" : "refund.failed",
        entity: "refund",
        entityId: refund.id,
        meta: { refundId: refund.id, orderId: refund.orderId, amountKobo },
      },
      tx,
    );
    return "SETTLED" as const;
  });
  // A refund Paystack could not complete must be paid back by hand: tell the admins.
  if (result === "SETTLED" && outcome === "FAILED") {
    await alertAdmins({ kind: "REFUND_FAILED", orderId: refund.orderId, amountKobo, recipientType: "BUYER" });
  }
  return result;
}
