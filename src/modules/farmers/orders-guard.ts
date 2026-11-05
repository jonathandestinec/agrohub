import { prisma } from "@/lib/db";

// Leaving a cooperative is blocked while any order on a lot the farmer contributes to is
// unfinished (spec 6.2): paid and not yet completed, refunded or cancelled. Phase 5b adds
// completed orders whose payout to this farmer is not yet paid.
export async function hasUnfinishedOrders(farmerUserId: string): Promise<boolean> {
  const open = await prisma.order.count({
    where: {
      status: { in: ["PAID_HELD", "PREPARING", "DELIVERED_MARKED", "DISPUTED", "TIMED_OUT"] },
      lot: { contributions: { some: { farmerUserId } } },
    },
  });
  return open > 0;
}
