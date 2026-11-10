import { prisma } from "@/lib/db";

// A lot can be withdrawn only while no order on it is open (spec 14): paid and not finished, or
// a checkout still inside its 15-minute reservation. Reads the order table directly: orders
// import catalog, not the other way round.
export async function hasOpenOrders(lotId: string, now: Date = new Date()): Promise<boolean> {
  const open = await prisma.order.count({
    where: {
      lotId,
      OR: [
        { status: { in: ["PAID_HELD", "PREPARING", "DELIVERED_MARKED", "DISPUTED", "TIMED_OUT"] } },
        { status: "PENDING_PAYMENT", reservation: { expiresAt: { gt: now } } },
      ],
    },
  });
  return open > 0;
}
