import type { OrderStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { lagosDateKey } from "@/lib/lagos-date";

// Orders whose quantity is sold: paid and not cancelled or refunded. The whole ordered quantity
// counts even when less was delivered: undelivered units are refunded, never resold.
export const SOLD_STATUSES: readonly OrderStatus[] = [
  "PAID_HELD",
  "PREPARING",
  "DELIVERED_MARKED",
  "COMPLETED",
  "DISPUTED",
  "TIMED_OUT",
];

/**
 * The quantity of a lot that is sold, reserved by a checkout in its 15 minutes, or held by an
 * accepted offer still inside its time to pay. Stock is computed, never decremented. A
 * checkout from an accepted offer reserves nothing extra (the offer already holds it), and an
 * offer whose order was paid is ORDERED, so the order counts instead. `exclude` leaves out one
 * order and one offer, for a payment re-checking its own stock.
 */
export async function committedQuantity(
  tx: Prisma.TransactionClient,
  lotId: string,
  now: Date,
  exclude: { orderId?: string; offerId?: string } = {},
): Promise<number> {
  const notOrder = exclude.orderId ? { id: { not: exclude.orderId } } : {};
  const sold = await tx.order.findMany({
    where: { lotId, status: { in: [...SOLD_STATUSES] }, ...notOrder },
    select: { quantity: true },
  });
  const soldQuantity = sold.reduce((sum, o) => sum + o.quantity, 0);
  const reserved = await tx.stockReservation.aggregate({
    where: {
      lotId,
      countsTowardStock: true,
      expiresAt: { gt: now },
      order: { status: "PENDING_PAYMENT", ...notOrder },
    },
    _sum: { quantity: true },
  });
  const held = await tx.offer.aggregate({
    where: {
      lotId,
      status: "ACCEPTED",
      payByAt: { gt: now },
      ...(exclude.offerId ? { id: { not: exclude.offerId } } : {}),
    },
    _sum: { quantity: true },
  });
  return soldQuantity + (reserved._sum.quantity ?? 0) + (held._sum.quantity ?? 0);
}

// Public read, no Actor: how much of a lot a buyer can still take. Never negative.
export async function availableQuantity(lotId: string, now: Date = new Date()): Promise<number> {
  const lot = await prisma.lot.findUnique({ where: { id: lotId }, select: { quantity: true } });
  if (!lot) return 0;
  return Math.max(0, lot.quantity - (await committedQuantity(prisma, lotId, now)));
}

// A live lot whose whole quantity is sold becomes SOLD_OUT (no longer on sale). Called under
// the lot's row lock by payment confirmation.
export async function refreshSoldOut(tx: Prisma.TransactionClient, lotId: string): Promise<void> {
  const lot = await tx.lot.findUniqueOrThrow({ where: { id: lotId }, select: { quantity: true, status: true } });
  if (lot.status !== "LIVE") return;
  const sold = await tx.order.findMany({
    where: { lotId, status: { in: [...SOLD_STATUSES] } },
    select: { quantity: true },
  });
  const soldQuantity = sold.reduce((sum, o) => sum + o.quantity, 0);
  if (soldQuantity >= lot.quantity) {
    await tx.lot.updateMany({ where: { id: lotId, status: "LIVE" }, data: { status: "SOLD_OUT" } });
  }
}

/**
 * After an order is refunded before delivery: a SOLD_OUT lot goes back on sale if stock is free
 * again and its available-until date (a Lagos day) has not passed.
 */
export async function reopenIfFree(tx: Prisma.TransactionClient, lotId: string, now: Date): Promise<void> {
  const lot = await tx.lot.findUniqueOrThrow({ where: { id: lotId }, select: { quantity: true, status: true, availableUntil: true } });
  if (lot.status !== "SOLD_OUT") return;
  if (lot.availableUntil.toISOString().slice(0, 10) < lagosDateKey(now)) return;
  if ((await committedQuantity(tx, lotId, now)) >= lot.quantity) return;
  await tx.lot.updateMany({ where: { id: lotId, status: "SOLD_OUT" }, data: { status: "LIVE" } });
}
