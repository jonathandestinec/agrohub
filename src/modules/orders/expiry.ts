import { prisma } from "@/lib/db";
import { recordAudit } from "@/modules/audit/audit";
import { UNPAID_ORDER_HOURS } from "./checkout";

// The daily order-expiry job: checkouts still unpaid 24 hours after they started are cancelled
// (PAYMENT_EXPIRED). Their 15-minute reservations stopped counting long before; this records it
// and frees the delivery quote. A payment that still lands later is re-checked like any other.
// Safe to run twice: each update is conditional on PENDING_PAYMENT. Returns how many it expired.
export async function expireUnpaidOrders(now: Date = new Date()): Promise<number> {
  const due = await prisma.order.findMany({
    where: { status: "PENDING_PAYMENT", createdAt: { lte: new Date(now.getTime() - UNPAID_ORDER_HOURS * 3_600_000) } },
    select: { id: true },
  });
  let expired = 0;
  for (const order of due) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: order.id, status: "PENDING_PAYMENT" },
        data: { status: "CANCELLED", cancelReason: "PAYMENT_EXPIRED", deliveryQuoteId: null },
      });
      if (count === 0) return;
      expired += 1;
      await tx.stockReservation.deleteMany({ where: { orderId: order.id } });
      await recordAudit(
        { actorId: null, action: "order.expire", entity: "order", entityId: order.id, meta: { orderId: order.id } },
        tx,
      );
    });
  }
  return expired;
}
