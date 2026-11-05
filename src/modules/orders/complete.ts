import { prisma } from "@/lib/db";
import { recordAudit } from "@/modules/audit/audit";

export type CompletedBy = "BUYER" | "AUTO" | "ADMIN";

/**
 * System function: callers check permissions. Completes a delivered (or admin-decided) order
 * once. Returns false if the order was not in a state that can complete.
 */
export async function completeOrder(orderId: string, by: CompletedBy, now: Date): Promise<boolean> {
  const { count } = await prisma.order.updateMany({
    where: { id: orderId, status: { in: ["DELIVERED_MARKED", "DISPUTED", "TIMED_OUT"] } },
    data: { status: "COMPLETED", completedAt: now },
  });
  if (count === 0) return false;
  await recordAudit({ actorId: null, action: "order.completed", entity: "order", entityId: orderId, meta: { orderId, by } });
  return true;
}
