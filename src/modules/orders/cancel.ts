import type { OrderStatus, Prisma, RefundReason } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { koboFromDb, koboToDb } from "@/lib/money";
import { recordAudit } from "@/modules/audit/audit";
import { lockLot, reopenIfFree } from "@/modules/catalog/service";
import { can, type Actor } from "@/modules/identity/policies";
import { assertMessageAllowed, ensureBuyerThread, postSystemMessage } from "@/modules/messaging/service";
import { issueRefund, postLedger } from "@/modules/payments/service";
import { notifyOrder, type OrderAudience } from "./alerts";
import { loadManagedOrder, loadOwnOrder } from "./delivery";
import { assertTransition } from "./state";

const REASON_MIN = 5;
const REASON_MAX = 500;

export type RefundAllInput = {
  orderId: string;
  from: readonly OrderStatus[];
  reason: RefundReason;
  purpose: "cancel" | "dispute";
  by: "BUYER" | "COOPERATIVE" | "ADMIN";
  actorUserId: string;
  data?: Prisma.OrderUpdateManyMutationInput;
  now: Date;
  // The alert to write in the same transaction, so it exists exactly when the refund does.
  alert?: { kind: "ORDER_CANCELLED_BY_BUYER" | "ORDER_CANCELLED_BY_COOPERATIVE" | "CANCEL_REQUEST_AGREED"; audience: OrderAudience[] };
};

/**
 * Inside a caller's checks: refunds an order in full (goods and delivery) once and marks it
 * REFUNDED, in one transaction under the lot's lock. The status update is conditional, so two
 * cancellations at once refund once. The lot is back on sale if it had sold out and its
 * available-until date has not passed. Returns the refund to send after commit.
 */
export async function refundInFull(input: RefundAllInput): Promise<{ refundId: string; amountKobo: number }> {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
    await lockLot(tx, order.lotId);
    if (!input.from.includes(order.status)) throw new ConflictError("The order cannot do that now", "ORDER_STATE");
    assertTransition(order.status, "REFUNDED");
    const { count } = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { ...input.data, status: "REFUNDED", cancelReason: input.reason },
    });
    if (count === 0) throw new ConflictError("The order cannot do that now", "ORDER_STATE");
    const earlier = await tx.refund.aggregate({ where: { orderId: order.id, status: { not: "FAILED" } }, _sum: { amountKobo: true } });
    const amountKobo = koboFromDb(order.totalKobo) - koboFromDb(earlier._sum.amountKobo ?? BigInt(0));
    if (amountKobo <= 0) throw new Error("NOTHING_TO_REFUND");
    const refund = await tx.refund.create({
      data: {
        orderId: order.id,
        purpose: input.purpose,
        reason: input.reason,
        amountKobo: koboToDb(amountKobo),
        requestedByUserId: input.actorUserId,
        createdAt: input.now,
      },
    });
    await postLedger(tx, {
      orderId: order.id,
      kind: "refund.issued",
      lines: [
        { account: "HELD", amountKobo },
        { account: "REFUND_PAYABLE", amountKobo: -amountKobo },
      ],
    });
    await reopenIfFree(tx, order.lotId, input.now);
    await recordAudit(
      {
        actorId: input.actorUserId,
        action: input.purpose === "cancel" ? "order.cancel" : "order.refund_all",
        entity: "order",
        entityId: order.id,
        meta: { orderId: order.id, by: input.by, refundKobo: amountKobo },
      },
      tx,
    );
    if (input.alert) {
      await notifyOrder(tx, order.id, input.alert.kind, input.alert.audience, input.actorUserId);
    }
    return { refundId: refund.id, amountKobo, lotId: order.lotId, buyerUserId: order.buyerUserId };
  });
  await issueRefund(result.refundId);
  return { refundId: result.refundId, amountKobo: result.amountKobo };
}

async function postLine(order: { lotId: string; buyerUserId: string }, actorUserId: string, text: string, now: Date) {
  const threadId = await ensureBuyerThread(order.lotId, order.buyerUserId);
  await postSystemMessage(threadId, actorUserId, text, now);
}

// A reason someone typed: trimmed, 5 to 500 characters, and through the message guards (no
// phone numbers, emails or the floor), since it is shown in the thread.
async function checkedReason(actor: Actor, lotId: string, reason: string, required: boolean): Promise<string | null> {
  const text = reason.trim();
  if (!text && !required) return null;
  if (text.length < REASON_MIN || text.length > REASON_MAX) throw new ValidationError("Give a reason", "REASON_REQUIRED");
  const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId }, select: { floorKobo: true } });
  return assertMessageAllowed(actor, { kind: "BUYER_COOPERATIVE", floorKobo: lot.floorKobo }, text);
}

/**
 * Cancelling before delivery. The buyer cancels a paid order not yet being prepared at once
 * (full refund); once the cooperative is preparing, the buyer can only ask, and the officer
 * answers. The officer can cancel either, with a reason, and it counts against the cooperative.
 */
export async function cancelOrder(actor: Actor, orderId: string, reason: string, now: Date = new Date()): Promise<void> {
  if (actor.role === "BUYER") {
    const order = await loadOwnOrder(actor, orderId);
    if (order.status === "PAID_HELD") {
      const text = await checkedReason(actor, order.lotId, reason, false);
      await refundInFull({
        orderId,
        from: ["PAID_HELD"],
        reason: "BUYER_CANCEL",
        purpose: "cancel",
        by: "BUYER",
        actorUserId: actor.userId,
        now,
        alert: { kind: "ORDER_CANCELLED_BY_BUYER", audience: ["officers"] },
      });
      await postLine(order, actor.userId, `The buyer cancelled the order${text ? `: ${text}` : ""}. The payment is refunded in full.`, now);
      return;
    }
    if (order.status === "PREPARING") {
      const text = await checkedReason(actor, order.lotId, reason, false);
      const { count } = await prisma.order.updateMany({ where: { id: orderId, status: "PREPARING" }, data: { cancelRequestedAt: now } });
      if (count === 0) throw new ConflictError("The order cannot do that now", "ORDER_STATE");
      // Only the first request alerts: asking again moves nothing (the line is posted each time).
      if (order.cancelRequestedAt === null) {
        await notifyOrder(prisma, orderId, "ORDER_CANCEL_REQUESTED", ["officers"], actor.userId);
      }
      await postLine(order, actor.userId, `The buyer asked to cancel${text ? `: ${text}` : ""}`, now);
      await recordAudit({ actorId: actor.userId, action: "order.cancel_request", entity: "order", entityId: orderId, meta: { orderId } });
      return;
    }
    throw new ConflictError("The order cannot do that now", "ORDER_STATE");
  }
  if (actor.role !== "OFFICER") throw new ForbiddenError();
  const order = await loadManagedOrder(actor, orderId);
  if (order.status !== "PAID_HELD" && order.status !== "PREPARING") throw new ConflictError("The order cannot do that now", "ORDER_STATE");
  const text = await checkedReason(actor, order.lotId, reason, true);
  await refundInFull({
    orderId,
    from: ["PAID_HELD", "PREPARING"],
    reason: "COOPERATIVE_CANCEL",
    purpose: "cancel",
    by: "COOPERATIVE",
    actorUserId: actor.userId,
    data: { cancelledByCooperative: true },
    now,
    alert: { kind: "ORDER_CANCELLED_BY_COOPERATIVE", audience: ["buyer"] },
  });
  await postLine(order, actor.userId, `The cooperative cancelled the order: ${text}. The payment is refunded in full.`, now);
}

/** The officer agrees to (full refund) or declines a buyer's request to cancel. */
export async function answerCancelRequest(actor: Actor, orderId: string, agree: boolean, now: Date = new Date()): Promise<void> {
  const order = await loadManagedOrder(actor, orderId);
  if (!order.cancelRequestedAt || (order.status !== "PREPARING" && order.status !== "PAID_HELD")) {
    throw new ConflictError("There is no request to cancel", "NO_CANCEL_REQUEST");
  }
  if (agree) {
    await refundInFull({
      orderId,
      from: ["PAID_HELD", "PREPARING"],
      reason: "BUYER_CANCEL",
      purpose: "cancel",
      by: "BUYER",
      actorUserId: actor.userId,
      data: { cancelRequestedAt: null },
      now,
      alert: { kind: "CANCEL_REQUEST_AGREED", audience: ["buyer"] },
    });
    await postLine(order, actor.userId, "The cooperative agreed to cancel. The payment is refunded in full.", now);
  } else {
    const { count } = await prisma.order.updateMany({
      where: { id: orderId, cancelRequestedAt: { not: null } },
      data: { cancelRequestedAt: null },
    });
    if (count === 0) throw new ConflictError("There is no request to cancel", "NO_CANCEL_REQUEST");
    await notifyOrder(prisma, orderId, "CANCEL_REQUEST_REFUSED", ["buyer"], actor.userId);
    await postLine(order, actor.userId, "The cooperative declined the request to cancel. The order goes ahead.", now);
  }
  await recordAudit({
    actorId: actor.userId,
    action: "order.cancel_request_answer",
    entity: "order",
    entityId: orderId,
    meta: { orderId, agree },
  });
}

/** Admin read: how many orders a cooperative has cancelled (shown on its admin page). */
export async function cooperativeCancellations(actor: Actor, cooperativeId: string): Promise<number> {
  if (!can(actor, "order:admin")) throw new ForbiddenError();
  return prisma.order.count({ where: { cooperativeId, cancelledByCooperative: true } });
}
