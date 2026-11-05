import type { Order, OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, isDateKey, lagosDate, lagosDateKey } from "@/lib/lagos-date";
import { recordAudit } from "@/modules/audit/audit";
import { can, type Actor } from "@/modules/identity/policies";
import { ensureBuyerThread, postSystemMessage } from "@/modules/messaging/service";
import { completeOrder } from "./complete";
import { closeTimeout } from "./disputes";
import { assertTransition } from "./state";

export const DELIVERY_DATE_MAX_DAYS = 60;

const DAY = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

// The cooperative's order: an officer of another cooperative sees it as missing; anyone who is
// not an officer is refused outright.
export async function loadManagedOrder(actor: Actor, orderId: string): Promise<Order> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || !can(actor, "order:manage", { cooperativeId: order.cooperativeId })) {
    if (actor.role !== "OFFICER") throw new ForbiddenError();
    throw new NotFoundError("ORDER_NOT_FOUND");
  }
  return order;
}

// The buyer's own order; another buyer's order and a missing one look the same.
export async function loadOwnOrder(actor: Actor, orderId: string): Promise<Order> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || !can(actor, "order:own", { ownerUserId: order.buyerUserId })) {
    if (actor.role !== "BUYER") throw new ForbiddenError();
    throw new NotFoundError("ORDER_NOT_FOUND");
  }
  return order;
}

// Moves an order from one of `from` to `to` only if it is still there: two clicks, or a click
// racing a job, change it once.
async function moveOrder(order: Order, from: readonly OrderStatus[], to: OrderStatus, data: Record<string, unknown>): Promise<void> {
  if (!from.includes(order.status)) throw new ConflictError("The order cannot do that now", "ORDER_STATE");
  assertTransition(order.status, to);
  const { count } = await prisma.order.updateMany({
    where: { id: order.id, status: order.status },
    data: { status: to, ...data },
  });
  if (count === 0) throw new ConflictError("The order cannot do that now", "ORDER_STATE");
}

async function postToOrderThread(order: Order, causedByUserId: string, text: string, now: Date): Promise<void> {
  const threadId = await ensureBuyerThread(order.lotId, order.buyerUserId);
  await postSystemMessage(threadId, causedByUserId, text, now);
}

/** The officer starts preparing a paid order. */
export async function startPreparing(actor: Actor, orderId: string, now: Date = new Date()): Promise<void> {
  const order = await loadManagedOrder(actor, orderId);
  await moveOrder(order, ["PAID_HELD"], "PREPARING", { preparingAt: now });
  await recordAudit({ actorId: actor.userId, action: "order.preparing", entity: "order", entityId: orderId, meta: { orderId } });
}

/**
 * The officer proposes a delivery or pickup date (a Lagos calendar day, today to 60 days on).
 * The buyer asks for another in the thread.
 */
export async function setDeliveryDate(actor: Actor, orderId: string, date: string, now: Date = new Date()): Promise<void> {
  const order = await loadManagedOrder(actor, orderId);
  if (order.status !== "PAID_HELD" && order.status !== "PREPARING") {
    throw new ConflictError("The order cannot do that now", "ORDER_STATE");
  }
  const today = lagosDateKey(now);
  if (!isDateKey(date) || date < today || date > addDays(today, DELIVERY_DATE_MAX_DAYS)) {
    throw new ValidationError("Delivery date out of range", "DELIVERY_DATE_RANGE");
  }
  const { count } = await prisma.order.updateMany({
    where: { id: orderId, status: { in: ["PAID_HELD", "PREPARING"] } },
    data: { deliveryDate: lagosDate(date) },
  });
  if (count === 0) throw new ConflictError("The order cannot do that now", "ORDER_STATE");
  await postToOrderThread(order, actor.userId, `Delivery date proposed: ${DAY.format(lagosDate(date))}`, now);
  await recordAudit({
    actorId: actor.userId,
    action: "order.delivery_date",
    entity: "order",
    entityId: orderId,
    meta: { orderId, date },
  });
}

/**
 * The officer marks the order delivered with the quantity actually delivered. A timed-out order
 * can still be marked (late), which closes its timeout; a disputed one cannot.
 */
export async function markDelivered(actor: Actor, orderId: string, deliveredQuantity: number, now: Date = new Date()): Promise<void> {
  const order = await loadManagedOrder(actor, orderId);
  if (!Number.isSafeInteger(deliveredQuantity) || deliveredQuantity < 1 || deliveredQuantity > order.quantity) {
    throw new ValidationError("Delivered quantity out of range", "DELIVERED_RANGE");
  }
  await moveOrder(order, ["PAID_HELD", "PREPARING", "TIMED_OUT"], "DELIVERED_MARKED", { deliveredQuantity, deliveredMarkedAt: now });
  if (order.status === "TIMED_OUT") await closeTimeout(prisma, orderId, now);
  const lot = await prisma.lot.findUniqueOrThrow({ where: { id: order.lotId }, select: { unit: { select: { name: true } } } });
  await postToOrderThread(order, actor.userId, `Marked delivered: ${deliveredQuantity} of ${order.quantity} ${lot.unit.name}`, now);
  await recordAudit({
    actorId: actor.userId,
    action: "order.delivered",
    entity: "order",
    entityId: orderId,
    meta: { orderId, deliveredQuantity },
  });
}

/** The buyer confirms they received a delivered order: the payment is released. */
export async function confirmReceipt(actor: Actor, orderId: string, now: Date = new Date()): Promise<void> {
  const order = await loadOwnOrder(actor, orderId);
  if (order.status !== "DELIVERED_MARKED") throw new ConflictError("The order cannot do that now", "ORDER_STATE");
  const done = await completeOrder(orderId, "BUYER", now);
  if (!done) throw new ConflictError("The order cannot do that now", "ORDER_STATE");
  await postToOrderThread(order, actor.userId, "The buyer confirmed receipt. Payment released.", now);
}
