import { prisma } from "@/lib/db";
import { koboFromDb, koboToDb } from "@/lib/money";
import { verifyTransaction } from "@/lib/paystack";
import { recordAudit } from "@/modules/audit/audit";
import { committedQuantity, lockLot, refreshSoldOut } from "@/modules/catalog/service";
import { markOfferOrdered } from "@/modules/marketplace/service";
import { ensureBuyerThread } from "@/modules/messaging/service";
import { assertTransition } from "@/modules/orders/service";
import { postLedger } from "./ledger";
import { issueRefund } from "./refunds";

export type ConfirmOutcome = "PAID" | "REFUNDING" | "ALREADY_CONFIRMED" | "UNKNOWN_REFERENCE" | "VERIFY_MISMATCH";

/**
 * System function, no Actor: the webhook (after its signature check) and reconciliation call it.
 * Asks Paystack to verify the transaction; only a success for exactly the payment's amount in
 * NGN counts. Then, under the lot's row lock, the order is paid if its stock is still free (it
 * may not be: a payment can land after its 15-minute reservation and another buyer's purchase),
 * otherwise the payment is refunded in full automatically. Safe to run twice: the payment's
 * INITIALIZED -> SUCCEEDED update decides.
 */
export async function confirmPayment(reference: string, now: Date = new Date()): Promise<ConfirmOutcome> {
  const payment = await prisma.payment.findUnique({ where: { reference }, include: { order: true } });
  if (!payment) return "UNKNOWN_REFERENCE";
  if (payment.status === "SUCCEEDED") return "ALREADY_CONFIRMED";
  const amountKobo = koboFromDb(payment.amountKobo);
  const verified = await verifyTransaction(reference);
  if (verified.status !== "success" || verified.amountKobo !== amountKobo || verified.currency !== "NGN") {
    await recordAudit({
      actorId: null,
      action: "payment.verify_mismatch",
      entity: "payment",
      entityId: payment.id,
      meta: { paymentId: payment.id, status: verified.status, amountMatches: verified.amountKobo === amountKobo },
    });
    return "VERIFY_MISMATCH";
  }

  const result = await prisma.$transaction(async (tx) => {
    const orderId = payment.orderId;
    await lockLot(tx, payment.order.lotId);
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: "INITIALIZED" },
      data: {
        status: "SUCCEEDED",
        paystackTransactionId: verified.transactionId,
        feesKobo: koboToDb(verified.feesKobo),
        channel: verified.channel,
        confirmedAt: now,
      },
    });
    if (count === 0) return { outcome: "ALREADY_CONFIRMED" as const, refundId: null };
    await postLedger(tx, {
      orderId,
      kind: "payment.captured",
      lines: [
        { account: "PAYSTACK_BALANCE", amountKobo },
        { account: "HELD", amountKobo: -amountKobo },
      ],
    });
    if (verified.feesKobo > 0) {
      await postLedger(tx, {
        orderId,
        kind: "paystack.fee",
        lines: [
          { account: "PAYSTACK_FEES", amountKobo: verified.feesKobo },
          { account: "PAYSTACK_BALANCE", amountKobo: -verified.feesKobo },
        ],
      });
    }
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const lot = await tx.lot.findUniqueOrThrow({
      where: { id: order.lotId },
      select: { quantity: true, status: true, cooperative: { select: { status: true } } },
    });
    const committed = await committedQuantity(tx, order.lotId, now, {
      orderId,
      offerId: order.offerId ?? undefined,
    });
    const unpaid = order.status === "PENDING_PAYMENT" || order.status === "CANCELLED";
    const sellable =
      unpaid &&
      (lot.status === "LIVE" || lot.status === "SOLD_OUT") &&
      lot.cooperative.status === "VERIFIED" &&
      order.quantity <= lot.quantity - committed;
    await tx.stockReservation.deleteMany({ where: { orderId } });

    if (sellable) {
      assertTransition(order.status, "PAID_HELD");
      await tx.order.update({ where: { id: orderId }, data: { status: "PAID_HELD", paidAt: now, cancelReason: null } });
      if (order.offerId) await markOfferOrdered(tx, order.offerId, now);
      await refreshSoldOut(tx, order.lotId);
      await recordAudit(
        {
          actorId: null,
          action: "order.paid",
          entity: "order",
          entityId: orderId,
          meta: { orderId, paymentId: payment.id, totalKobo: amountKobo },
        },
        tx,
      );
      return { outcome: "PAID" as const, refundId: null, lotId: order.lotId, buyerUserId: order.buyerUserId };
    }

    // Too late: the stock went to another buyer, or the lot or cooperative stopped selling.
    if (unpaid) {
      assertTransition(order.status, "REFUNDED");
      await tx.order.update({ where: { id: orderId }, data: { status: "REFUNDED", cancelReason: "LATE_PAYMENT" } });
    }
    const refund = await tx.refund.create({
      data: { orderId, purpose: "late", reason: "LATE_PAYMENT", amountKobo: koboToDb(amountKobo), createdAt: now },
    });
    await postLedger(tx, {
      orderId,
      kind: "refund.issued",
      lines: [
        { account: "HELD", amountKobo },
        { account: "REFUND_PAYABLE", amountKobo: -amountKobo },
      ],
    });
    await recordAudit(
      {
        actorId: null,
        action: "order.late_payment_refund",
        entity: "order",
        entityId: orderId,
        meta: { orderId, refundId: refund.id, amountKobo },
      },
      tx,
    );
    return { outcome: "REFUNDING" as const, refundId: refund.id };
  });
  if (result.refundId) await issueRefund(result.refundId);
  // Every paid order has its thread with the cooperative (the order thread), even if the buyer
  // never wrote before and the lot is now sold out.
  if (result.outcome === "PAID") await ensureBuyerThread(result.lotId, result.buyerUserId);
  return result.outcome;
}
