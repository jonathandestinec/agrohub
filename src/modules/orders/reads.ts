import type { OrderStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { koboFromDb, orderSplit } from "@/lib/money";
import { can, type Actor } from "@/modules/identity/policies";
import { buyerThreadIdOf, buyerThreadVersionOf } from "@/modules/messaging/service";
import { toBuyerOrder, toOfficerOrder, type BuyerOrder, type OfficerOrder } from "./views";

// What every order view loads with the order: the lot's names (never its floor), the
// reservation and the refunds. Contributions and the buyer's name are only used by the
// cooperative's view.
const ORDER_INCLUDE = {
  lot: {
    select: {
      id: true,
      crop: { select: { name: true } },
      unit: { select: { name: true } },
      cooperative: { select: { name: true } },
    },
  },
  reservation: { select: { expiresAt: true } },
  refunds: { select: { amountKobo: true, status: true } },
} as const;

const COOPERATIVE_INCLUDE = {
  ...ORDER_INCLUDE,
  buyer: { select: { name: true } },
  lot: {
    select: {
      ...ORDER_INCLUDE.lot.select,
      contributions: { select: { quantity: true, farmerUserId: true }, orderBy: { id: "asc" } },
    },
  },
} as const;

// Orders the cooperative works on: paid, whatever happened next. Abandoned checkouts are not theirs.
const COOPERATIVE_STATUSES: readonly OrderStatus[] = [
  "PAID_HELD",
  "PREPARING",
  "DELIVERED_MARKED",
  "COMPLETED",
  "REFUNDED",
  "DISPUTED",
  "TIMED_OUT",
];

type LoadedOrder = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;
type CooperativeOrderRow = NonNullable<Awaited<ReturnType<typeof loadCooperativeOrder>>>;

function loadOrder(orderId: string) {
  return prisma.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
}

function loadCooperativeOrder(orderId: string) {
  return prisma.order.findUnique({ where: { id: orderId }, include: COOPERATIVE_INCLUDE });
}

async function buyerView(order: LoadedOrder, now: Date): Promise<BuyerOrder> {
  const lot = {
    id: order.lot.id,
    crop: order.lot.crop.name,
    unit: order.lot.unit.name,
    cooperativeName: order.lot.cooperative.name,
  };
  return toBuyerOrder(order, lot, await buyerThreadIdOf(order.lotId, order.buyerUserId), now);
}

async function farmerPayoutTotals(orderId: string): Promise<Map<string, number>> {
  const rows = await prisma.payout.findMany({ where: { orderId, recipientType: "FARMER" }, select: { recipientId: true, amountKobo: true } });
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.recipientId, (totals.get(r.recipientId) ?? 0) + koboFromDb(r.amountKobo));
  return totals;
}

async function officerView(order: CooperativeOrderRow, now: Date): Promise<OfficerOrder> {
  const contributions = order.lot.contributions;
  const split = orderSplit({
    unitKobo: order.unitKobo,
    quantity: order.deliveredQuantity ?? order.quantity,
    cutBps: order.cutBps,
    feeBps: order.feeBps,
    deliveryKobo: 0,
    contributions: contributions.length > 0 ? contributions.map((c) => c.quantity) : [1],
  });
  // Once completed, the payouts made at completion are the record of each farmer's share.
  const paid = order.status === "COMPLETED" ? await farmerPayoutTotals(order.id) : null;
  const farmers = await prisma.user.findMany({
    where: { id: { in: contributions.map((c) => c.farmerUserId) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(farmers.map((f) => [f.id, f.name]));
  return toOfficerOrder(await buyerView(order, now), {
    buyerName: order.buyer.name,
    orderStatus: order.status,
    cutKobo: split.cutKobo,
    feeKobo: split.feeKobo,
    farmerShares: contributions
      .map((c, i) => ({ c, amountKobo: paid ? (paid.get(c.farmerUserId) ?? null) : split.farmerKobo[i] }))
      .filter((s): s is { c: (typeof contributions)[number]; amountKobo: number } => s.amountKobo !== null)
      .map(({ c, amountKobo }) => ({ farmerName: nameOf.get(c.farmerUserId) ?? "", quantity: c.quantity, amountKobo })),
  });
}

// A string that changes whenever the order page would show something different. The row's
// updatedAt covers every status step and date. Disputes and refunds are counted too, because an
// after-completion report, a note decision and a refund's own progress leave the order row alone.
// The buyer's thread on the lot is included because the page shows it. Same access as the page
// (the buyer's own order; the cooperative's paid orders); anyone else gets "not found".
export async function orderVersion(actor: Actor, orderId: string): Promise<string> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      buyerUserId: true,
      cooperativeId: true,
      lotId: true,
      paidAt: true,
      status: true,
      updatedAt: true,
      disputes: { select: { status: true } },
      refunds: { select: { status: true } },
    },
  });
  const mayRead =
    order !== null &&
    (actor.role === "BUYER"
      ? can(actor, "order:own", { ownerUserId: order.buyerUserId })
      : actor.role === "OFFICER" &&
        order.paidAt !== null &&
        COOPERATIVE_STATUSES.includes(order.status) &&
        can(actor, "order:manage", { cooperativeId: order.cooperativeId }));
  if (!order || !mayRead) throw new NotFoundError("ORDER_NOT_FOUND");
  const openDisputes = order.disputes.filter((d) => d.status === "OPEN").length;
  const doneRefunds = order.refunds.filter((r) => r.status === "PROCESSED").length;
  const thread = await buyerThreadVersionOf(order.lotId, order.buyerUserId);
  return [
    order.updatedAt.getTime(),
    `${order.disputes.length}/${openDisputes}`,
    `${order.refunds.length}/${doneRefunds}`,
    thread,
  ].join("|");
}

// A string that changes when an order in the actor's list is added or changes: how many there
// are and the newest updatedAt. A superset of what the list shows (it lists the latest 50
// finished), so it can only over-report.
export async function ordersListVersion(actor: Actor): Promise<string> {
  let where: Prisma.OrderWhereInput;
  if (actor.role === "BUYER" && can(actor, "order:own", { ownerUserId: actor.userId })) {
    where = { buyerUserId: actor.userId };
  } else if (actor.role === "OFFICER" && actor.cooperativeId && can(actor, "order:manage", { cooperativeId: actor.cooperativeId })) {
    where = { cooperativeId: actor.cooperativeId, paidAt: { not: null }, status: { in: [...COOPERATIVE_STATUSES] } };
  } else {
    throw new ForbiddenError();
  }
  const summary = await prisma.order.aggregate({ where, _count: { _all: true }, _max: { updatedAt: true } });
  return `${summary._count._all}:${summary._max.updatedAt?.getTime() ?? 0}`;
}

// The buyer's own order; another buyer's order and a missing one look the same.
export async function getOwnOrder(actor: Actor, orderId: string, now: Date = new Date()): Promise<BuyerOrder> {
  const order = await loadOrder(orderId);
  if (!order || !can(actor, "order:own", { ownerUserId: order.buyerUserId })) throw new NotFoundError("ORDER_NOT_FOUND");
  return buyerView(order, now);
}

export async function listOwnOrders(actor: Actor, now: Date = new Date()): Promise<BuyerOrder[]> {
  if (!can(actor, "order:own", { ownerUserId: actor.userId })) throw new ForbiddenError();
  const orders = await prisma.order.findMany({
    where: { buyerUserId: actor.userId },
    include: ORDER_INCLUDE,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 100,
  });
  return Promise.all(orders.map((order) => buyerView(order, now)));
}

// A paid order of the officer's own cooperative; any other looks missing.
export async function getCooperativeOrder(actor: Actor, orderId: string, now: Date = new Date()): Promise<OfficerOrder> {
  const order = await loadCooperativeOrder(orderId);
  // paidAt: a late payment refunded at once was never the cooperative's sale.
  if (!order || !order.paidAt || !COOPERATIVE_STATUSES.includes(order.status) || !can(actor, "order:manage", { cooperativeId: order.cooperativeId })) {
    throw new NotFoundError("ORDER_NOT_FOUND");
  }
  return officerView(order, now);
}

// The cooperative's paid orders: open ones first by delivery date (undated last), then the
// latest 50 finished.
export async function listCooperativeOrders(actor: Actor, now: Date = new Date()): Promise<OfficerOrder[]> {
  if (!actor.cooperativeId || !can(actor, "order:manage", { cooperativeId: actor.cooperativeId })) throw new ForbiddenError();
  const open = await prisma.order.findMany({
    where: { cooperativeId: actor.cooperativeId, status: { in: ["PAID_HELD", "PREPARING", "DELIVERED_MARKED", "DISPUTED", "TIMED_OUT"] } },
    include: COOPERATIVE_INCLUDE,
    orderBy: [{ deliveryDate: { sort: "asc", nulls: "last" } }, { paidAt: "asc" }, { id: "asc" }],
  });
  const finished = await prisma.order.findMany({
    where: { cooperativeId: actor.cooperativeId, status: { in: ["COMPLETED", "REFUNDED"] }, paidAt: { not: null } },
    include: COOPERATIVE_INCLUDE,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 50,
  });
  return Promise.all([...open, ...finished].map((order) => officerView(order, now)));
}
