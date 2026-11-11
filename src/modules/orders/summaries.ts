import type { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { formatNaira, koboFromDb } from "@/lib/money";
import { TILE_ITEMS, type History, type Summary } from "@/lib/summary";
import { can, type Actor } from "@/modules/identity/policies";
import { listOwnEarnings } from "./statements";
import { buyerOrderStatusOf, toDisputeTileItem, toEarningsTileItem, toOrderTileItem } from "./views";

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

// ---- The buyer's own orders ----

function assertOwn(actor: Actor): void {
  if (!can(actor, "order:own", { ownerUserId: actor.userId })) throw new ForbiddenError();
}

const BUYER_ORDER_TILE = {
  id: true,
  quantity: true,
  status: true,
  cancelReason: true,
  deliveryDate: true,
  totalKobo: true,
  reservation: { select: { expiresAt: true } },
  lot: { select: { crop: { select: { name: true } }, unit: { select: { name: true } } } },
} as const;

// The buyer's orders marked delivered, waiting for the buyer to confirm receipt.
export async function deliveriesToConfirmSummary(actor: Actor): Promise<Summary> {
  assertOwn(actor);
  const where = { buyerUserId: actor.userId, status: "DELIVERED_MARKED" as const };
  const [count, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      select: BUYER_ORDER_TILE,
      orderBy: [{ deliveredMarkedAt: "asc" }, { id: "asc" }],
      take: TILE_ITEMS,
    }),
  ]);
  return { count, items: rows.map((row) => toOrderTileItem(row, `/buyer/orders/${row.id}`)) };
}

// The buyer's orders still moving: not yet paid, paid and held, being prepared, or with AgroHub.
// Each shows the status the buyer is told (an unpaid checkout past its window reads expired).
export async function buyerOpenOrdersSummary(actor: Actor, now: Date = new Date()): Promise<Summary> {
  assertOwn(actor);
  const where = {
    buyerUserId: actor.userId,
    status: { in: ["PENDING_PAYMENT", "PAID_HELD", "PREPARING", "DISPUTED", "TIMED_OUT"] as OrderStatus[] },
  };
  const [count, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      select: BUYER_ORDER_TILE,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: TILE_ITEMS,
    }),
  ]);
  return {
    count,
    items: rows.map((row) =>
      toOrderTileItem(row, `/buyer/orders/${row.id}`, {
        label: `orders.status.${buyerOrderStatusOf(row.status, row.cancelReason, row.reservation?.expiresAt ?? null, now)}`,
        date: row.deliveryDate ? row.deliveryDate.toISOString().slice(0, 10) : null,
      }),
    ),
  };
}

// The buyer's newest completed orders, each with the total they paid (their own money).
export async function recentReceiptsSummary(actor: Actor): Promise<History> {
  assertOwn(actor);
  const rows = await prisma.order.findMany({
    where: { buyerUserId: actor.userId, status: "COMPLETED" },
    select: BUYER_ORDER_TILE,
    orderBy: [{ completedAt: "desc" }, { id: "asc" }],
    take: TILE_ITEMS,
  });
  return {
    items: rows.map((row) =>
      toOrderTileItem(row, `/buyer/orders/${row.id}/receipt`, { detail: formatNaira(koboFromDb(row.totalKobo)) }),
    ),
  };
}

// ---- The admin's queue ----

// Open disputes (problems a buyer reported, late deliveries, suspended cooperatives), the same
// rows the admin order queue lists as disputes, without its cap, oldest first. No reason text.
export async function openDisputesSummary(actor: Actor): Promise<Summary> {
  if (!can(actor, "order:admin")) throw new ForbiddenError();
  const where = { status: "OPEN" as const };
  const [count, rows] = await Promise.all([
    prisma.dispute.count({ where }),
    prisma.dispute.findMany({
      where,
      select: {
        id: true,
        kind: true,
        orderId: true,
        createdAt: true,
        order: {
          select: { quantity: true, lot: { select: { crop: { select: { name: true } }, unit: { select: { name: true } } } } },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: TILE_ITEMS,
    }),
  ]);
  return { count, items: rows.map(toDisputeTileItem) };
}

// ---- The officer's cooperative ----

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
