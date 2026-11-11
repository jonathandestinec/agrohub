import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { TILE_ITEMS, type History, type Summary } from "@/lib/summary";
import { can, type Actor } from "@/modules/identity/policies";
import { listOwnEarnings } from "./statements";
import { toEarningsTileItem, toOrderTileItem } from "./views";

const ORDER_TILE = {
  id: true,
  quantity: true,
  status: true,
  paidAt: true,
  updatedAt: true,
  cancelRequestedAt: true,
  buyer: { select: { name: true } },
  lot: { select: { crop: { select: { name: true } }, unit: { select: { name: true } } } },
} as const;

// The farmer's newest completed sales. The amount comes from the same statements the earnings
// page lists (listOwnEarnings builds them, capped at 100 rows already), sliced to three, so it
// is never recomputed here.
export async function recentEarningsSummary(actor: Actor): Promise<History> {
  const statements = await listOwnEarnings(actor);
  return { items: statements.slice(0, TILE_ITEMS).map(toEarningsTileItem) };
}

// The cooperative the officer works for, after the same check the order list makes.
function assertManage(actor: Actor): string {
  if (!actor.cooperativeId || !can(actor, "order:manage", { cooperativeId: actor.cooperativeId })) {
    throw new ForbiddenError();
  }
  return actor.cooperativeId;
}

// Paid orders waiting for the cooperative to start preparing: PAID_HELD with no cancel request,
// the longest-paid first.
export async function ordersToPrepareSummary(actor: Actor): Promise<Summary> {
  const cooperativeId = assertManage(actor);
  const where = { cooperativeId, status: "PAID_HELD" as const, cancelRequestedAt: null };
  const [count, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      select: ORDER_TILE,
      orderBy: [{ paidAt: "asc" }, { id: "asc" }],
      take: TILE_ITEMS,
    }),
  ]);
  return {
    count,
    items: rows.map((row) => toOrderTileItem(row, `/officer/orders/${row.id}`, { detail: row.buyer.name, date: row.paidAt })),
  };
}

// Orders that need the cooperative's eye: DISPUTED or TIMED_OUT, or a buyer's cancel request on
// an order still being prepared. Longest-waiting first.
export async function officerAttentionSummary(actor: Actor): Promise<Summary> {
  const cooperativeId = assertManage(actor);
  const where = {
    cooperativeId,
    OR: [
      { status: { in: ["DISPUTED", "TIMED_OUT"] as ("DISPUTED" | "TIMED_OUT")[] } },
      { status: { in: ["PAID_HELD", "PREPARING"] as ("PAID_HELD" | "PREPARING")[] }, cancelRequestedAt: { not: null } },
    ],
  };
  const [count, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, select: ORDER_TILE, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: TILE_ITEMS }),
  ]);
  return {
    count,
    items: rows.map((row) =>
      toOrderTileItem(row, `/officer/orders/${row.id}`, {
        detail: row.buyer.name,
        date: row.updatedAt,
        label:
          row.status === "DISPUTED" || row.status === "TIMED_OUT"
            ? `orders.officerStatus.${row.status}`
            : "home.labels.CANCEL_REQUESTED",
      }),
    ),
  };
}
