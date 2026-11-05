import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { UnavailableError } from "@/lib/errors";
import { koboFromDb } from "@/lib/money";
import { refundTransaction } from "@/lib/paystack";
import { recordAudit } from "@/modules/audit/audit";
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
    if (!(error instanceof UnavailableError)) throw error;
  }
}

/** System function: Paystack's refund.processed or refund.failed webhook. Safe to run twice. */
export async function settleRefund(
  paystackRefundId: string,
  outcome: "PROCESSED" | "FAILED",
  now: Date = new Date(),
): Promise<"SETTLED" | "UNKNOWN_REFUND" | "ALREADY_SETTLED"> {
  const refund = await prisma.refund.findUnique({ where: { paystackRefundId } });
  if (!refund) return "UNKNOWN_REFUND";
  const amountKobo = koboFromDb(refund.amountKobo);
  return prisma.$transaction(async (tx) => {
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
    }
    // Admin alert emails for a failed refund arrive with Phase 5b's payout alerts.
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
}
