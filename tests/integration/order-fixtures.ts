import type { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Writes an order row directly, for stock and guard tests that need an order in a given state
// without running checkout and the webhook. Terms are the lot world's (cut 4%, fee 3%).
export async function seedOrder(input: {
  lotId: string;
  buyerUserId: string;
  quantity: number;
  status: OrderStatus;
  unitKobo?: number;
  deliveredQuantity?: number;
  reservation?: { expiresAt: Date; countsTowardStock?: boolean };
  offerId?: string;
  paidAt?: Date;
}): Promise<string> {
  const lot = await prisma.lot.findUniqueOrThrow({ where: { id: input.lotId } });
  const unitKobo = input.unitKobo ?? lot.askKobo;
  const order = await prisma.order.create({
    data: {
      lotId: lot.id,
      cooperativeId: lot.cooperativeId,
      buyerUserId: input.buyerUserId,
      offerId: input.offerId,
      quantity: input.quantity,
      unitKobo,
      cutBps: 400,
      feeBps: 300,
      deliveryMethod: "PICKUP",
      totalKobo: BigInt(unitKobo) * BigInt(input.quantity),
      status: input.status,
      deliveredQuantity: input.deliveredQuantity,
      paidAt: input.paidAt ?? (input.status === "PENDING_PAYMENT" ? null : new Date()),
    },
  });
  if (input.reservation) {
    await prisma.stockReservation.create({
      data: {
        lotId: lot.id,
        orderId: order.id,
        quantity: input.quantity,
        countsTowardStock: input.reservation.countsTowardStock ?? true,
        expiresAt: input.reservation.expiresAt,
      },
    });
  }
  return order.id;
}
