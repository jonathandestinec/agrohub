import type { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { koboFromDb, koboToDb, orderSplit, refundForUnits } from "@/lib/money";
import { recordAudit } from "@/modules/audit/audit";
import { alertAdmins, createPayouts, issueRefund, postLedger, sendDuePayouts, type CreatedPayout } from "@/modules/payments/service";
import { assertTransition } from "./state";

export type CompletedBy = "BUYER" | "AUTO" | "ADMIN";

const COMPLETABLE: readonly OrderStatus[] = ["DELIVERED_MARKED", "DISPUTED", "TIMED_OUT"];

/**
 * System function: callers check permissions (the buyer's confirmation, the auto-release job,
 * an admin's decision). Completes an order once, in one transaction: a refund of any units not
 * delivered (or refunded by an admin), the release in the ledger from the order's copied terms
 * on the delivered units, and one payout per recipient and transfer part. Returns false if the
 * order was not in a state that can complete (already completed, refunded, or not delivered).
 * After commit the refund is sent and the payouts due are sent.
 */
export async function completeOrder(orderId: string, by: CompletedBy, now: Date, adminUnitsRefunded = 0): Promise<boolean> {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { lot: { select: { contributions: { select: { farmerUserId: true, quantity: true }, orderBy: { id: "asc" } } } } },
    });
    if (!order || !COMPLETABLE.includes(order.status)) return null;
    assertTransition(order.status, "COMPLETED");
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: "COMPLETED", completedAt: now },
    });
    if (count === 0) return null;

    // An order an admin releases without a delivery mark counts as delivered in full.
    const marked = order.deliveredQuantity ?? order.quantity;
    const delivered = marked - adminUnitsRefunded;
    if (!Number.isSafeInteger(delivered) || delivered < 1 || delivered > order.quantity) throw new Error("COMPLETE_UNITS");
    const missing = order.quantity - delivered;

    let refund: { id: string; amountKobo: number } | null = null;
    if (missing > 0) {
      const amountKobo = refundForUnits(order.unitKobo, missing);
      const row = await tx.refund.create({
        data: {
          orderId,
          purpose: adminUnitsRefunded > 0 ? "dispute" : "shortfall",
          reason: adminUnitsRefunded > 0 ? "ADMIN_DECISION" : "SHORTFALL",
          amountKobo: koboToDb(amountKobo),
          createdAt: now,
        },
      });
      await postLedger(tx, {
        orderId,
        kind: "refund.issued",
        lines: [
          { account: "HELD", amountKobo },
          { account: "REFUND_PAYABLE", amountKobo: -amountKobo },
        ],
      });
      refund = { id: row.id, amountKobo };
    }

    // The farmers' contributions as they stand now, at completion: the payouts are the record
    // of who was owed what, whatever happens to the lot later.
    const contributions = order.lot.contributions;
    if (contributions.length === 0) throw new Error("ORDER_WITHOUT_CONTRIBUTIONS");
    const split = orderSplit({
      unitKobo: order.unitKobo,
      quantity: delivered,
      cutBps: order.cutBps,
      feeBps: order.feeBps,
      deliveryKobo: koboFromDb(order.deliveryKobo),
      contributions: contributions.map((c) => c.quantity),
    });

    // What is still held must be exactly what the split hands out.
    const held = await tx.ledgerEntry.aggregate({ where: { orderId, account: "HELD" }, _sum: { amountKobo: true } });
    const heldKobo = -koboFromDb(held._sum.amountKobo ?? BigInt(0));
    if (heldKobo !== split.totalKobo) throw new Error("RELEASE_MISMATCH");

    const lines = [
      { account: "HELD" as const, amountKobo: heldKobo },
      { account: "COOPERATIVE_PAYABLE" as const, amountKobo: -split.cooperativePayoutKobo, recipientRef: order.cooperativeId },
      ...contributions.map((c, i) => ({ account: "FARMER_PAYABLE" as const, amountKobo: -split.farmerKobo[i], recipientRef: c.farmerUserId })),
      { account: "PLATFORM_FEE" as const, amountKobo: -split.feeKobo },
    ].filter((line) => line.amountKobo !== 0);
    if (lines.length > 1) await postLedger(tx, { orderId, kind: "order.released", lines });

    const payouts = await createPayouts(
      tx,
      order,
      [
        { recipientType: "COOPERATIVE", recipientId: order.cooperativeId, amountKobo: split.cooperativePayoutKobo },
        ...contributions.map((c, i) => ({ recipientType: "FARMER" as const, recipientId: c.farmerUserId, amountKobo: split.farmerKobo[i] })),
      ],
      now,
    );
    await recordAudit(
      {
        actorId: null,
        action: "order.completed",
        entity: "order",
        entityId: orderId,
        meta: { orderId, by, deliveredQuantity: delivered, refundKobo: refund?.amountKobo ?? 0 },
      },
      tx,
    );
    return { refund, payouts };
  });
  if (!result) return false;
  await afterRelease(orderId, result.refund?.id ?? null, result.payouts, now);
  return true;
}

// Work after the release commits. Each step is safe to repeat and is retried by the daily jobs
// (payouts, reconciliation) if it fails here.
async function afterRelease(orderId: string, refundId: string | null, payouts: CreatedPayout[], now: Date): Promise<void> {
  if (refundId) await issueRefund(refundId);
  for (const payout of payouts.filter((p) => p.status === "BLOCKED")) {
    await alertAdmins({ kind: "BLOCKED", orderId, amountKobo: payout.amountKobo, recipientType: payout.recipientType });
  }
  try {
    await sendDuePayouts({ orderId, now });
  } catch (error) {
    console.error("payout send after release failed", { orderId, error: error instanceof Error ? error.name : "unknown" });
  }
}
