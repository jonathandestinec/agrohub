import { prisma } from "@/lib/db";

// Leaving a cooperative is blocked while any order on a lot the farmer contributes to is
// unfinished (spec 6.2): paid and not yet completed, refunded or cancelled, or completed with a
// payout to this farmer not yet paid. Reads the order and payout tables directly: orders and
// payments import farmers, not the other way round.
export async function hasUnfinishedOrders(farmerUserId: string): Promise<boolean> {
  const open = await prisma.order.count({
    where: {
      status: { in: ["PAID_HELD", "PREPARING", "DELIVERED_MARKED", "DISPUTED", "TIMED_OUT"] },
      lot: { contributions: { some: { farmerUserId } } },
    },
  });
  if (open > 0) return true;
  const unpaid = await prisma.payout.count({
    where: { recipientType: "FARMER", recipientId: farmerUserId, status: { not: "PAID" } },
  });
  return unpaid > 0;
}
