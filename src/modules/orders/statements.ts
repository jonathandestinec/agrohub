import type { PayoutStatus, RefundReason } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { applyBps, koboFromDb, lineTotalKobo, splitByWeights } from "@/lib/money";
import { can, type Actor } from "@/modules/identity/policies";
import { orderReference } from "./views";

// A buyer's receipt: the cooperative is the seller, AgroHub the platform. Built field by field.
export type Receipt = {
  id: string;
  reference: string;
  paidAt: string;
  cooperativeName: string;
  crop: string;
  unit: string;
  quantity: number;
  deliveredQuantity: number | null;
  unitKobo: number;
  goodsKobo: number;
  deliveryKobo: number;
  totalKobo: number;
  refunds: Array<{ amountKobo: number; reason: RefundReason; processed: boolean }>;
  netPaidKobo: number;
};

/** The buyer's receipt for a paid order; another buyer's order or an unpaid one looks missing. */
export async function getReceipt(actor: Actor, orderId: string): Promise<Receipt> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      lot: { select: { crop: { select: { name: true } }, unit: { select: { name: true } }, cooperative: { select: { name: true } } } },
      refunds: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order || !can(actor, "order:own", { ownerUserId: order.buyerUserId })) {
    if (actor.role !== "BUYER") throw new ForbiddenError();
    throw new NotFoundError("ORDER_NOT_FOUND");
  }
  if (!order.paidAt) throw new NotFoundError("ORDER_NOT_FOUND");
  const totalKobo = koboFromDb(order.totalKobo);
  const deliveryKobo = koboFromDb(order.deliveryKobo);
  const refunds = order.refunds
    .filter((r) => r.status !== "FAILED")
    .map((r) => ({ amountKobo: koboFromDb(r.amountKobo), reason: r.reason, processed: r.status === "PROCESSED" }));
  return {
    id: order.id,
    reference: orderReference(order.id),
    paidAt: order.paidAt.toISOString(),
    cooperativeName: order.lot.cooperative.name,
    crop: order.lot.crop.name,
    unit: order.lot.unit.name,
    quantity: order.quantity,
    deliveredQuantity: order.deliveredQuantity,
    unitKobo: order.unitKobo,
    goodsKobo: totalKobo - deliveryKobo,
    deliveryKobo,
    totalKobo,
    refunds,
    netPaidKobo: totalKobo - refunds.reduce((sum, r) => sum + r.amountKobo, 0),
  };
}

export type StatementPayoutStatus = "WAITING" | "SENDING" | "PAID" | "PROBLEM";

const PAYOUT_STATUS: Record<PayoutStatus, StatementPayoutStatus> = {
  QUEUED: "WAITING",
  SENT: "SENDING",
  PAID: "PAID",
  FAILED: "PROBLEM",
  BLOCKED: "PROBLEM",
};

// A farmer's statement for one completed order: their contribution, their share of the sale,
// the cut and fee apportioned to it, and what they take home (their payouts). No buyer
// identity, no other farmer's share.
export type EarningsStatement = {
  orderId: string;
  reference: string;
  completedAt: string;
  crop: string;
  unit: string;
  contributedQuantity: number;
  deliveredQuantity: number;
  unitKobo: number;
  cutBps: number;
  feeBps: number;
  grossShareKobo: number;
  cutKobo: number;
  feeKobo: number;
  takeHomeKobo: number;
  status: StatementPayoutStatus;
  payouts: Array<{ part: number; amountKobo: number; status: StatementPayoutStatus; paidAt: string | null }>;
};

const STATEMENT_INCLUDE = {
  lot: {
    select: {
      crop: { select: { name: true } },
      unit: { select: { name: true } },
      contributions: { select: { farmerUserId: true, quantity: true }, orderBy: { id: "asc" as const } },
    },
  },
  payouts: { where: { recipientType: "FARMER" as const }, orderBy: { part: "asc" as const } },
} as const;

type StatementRow = NonNullable<Awaited<ReturnType<typeof loadStatementRow>>>;

function loadStatementRow(orderId: string) {
  return prisma.order.findUnique({ where: { id: orderId }, include: STATEMENT_INCLUDE });
}

function overall(statuses: StatementPayoutStatus[]): StatementPayoutStatus {
  if (statuses.includes("PROBLEM")) return "PROBLEM";
  if (statuses.every((s) => s === "PAID")) return "PAID";
  if (statuses.includes("SENDING")) return "SENDING";
  return "WAITING";
}

function toStatement(order: StatementRow, farmerUserId: string): EarningsStatement | null {
  const contributions = order.lot.contributions;
  const index = contributions.findIndex((c) => c.farmerUserId === farmerUserId);
  const payouts = order.payouts.filter((p) => p.recipientId === farmerUserId);
  if (order.status !== "COMPLETED" || index < 0 || !order.completedAt) return null;
  const delivered = order.deliveredQuantity ?? order.quantity;
  // The payouts are the record of what the farmer is owed; the cut and fee are apportioned to
  // their share by the same weights, so the lines add up exactly.
  const goods = lineTotalKobo(order.unitKobo, delivered);
  const weights = contributions.map((c) => c.quantity);
  const cutKobo = splitByWeights(applyBps(goods, order.cutBps), weights)[index];
  const feeKobo = splitByWeights(applyBps(goods, order.feeBps), weights)[index];
  const takeHomeKobo = payouts.reduce((sum, p) => sum + koboFromDb(p.amountKobo), 0);
  const parts = payouts.map((p) => ({
    part: p.part,
    amountKobo: koboFromDb(p.amountKobo),
    status: PAYOUT_STATUS[p.status],
    paidAt: p.paidAt?.toISOString() ?? null,
  }));
  return {
    orderId: order.id,
    reference: orderReference(order.id),
    completedAt: order.completedAt.toISOString(),
    crop: order.lot.crop.name,
    unit: order.lot.unit.name,
    contributedQuantity: contributions[index].quantity,
    deliveredQuantity: delivered,
    unitKobo: order.unitKobo,
    cutBps: order.cutBps,
    feeBps: order.feeBps,
    grossShareKobo: takeHomeKobo + cutKobo + feeKobo,
    cutKobo,
    feeKobo,
    takeHomeKobo,
    status: parts.length > 0 ? overall(parts.map((p) => p.status)) : "PAID",
    payouts: parts,
  };
}

/** The farmer's statement for one completed order on a lot they contributed to. */
export async function getEarningsStatement(actor: Actor, orderId: string): Promise<EarningsStatement> {
  if (!can(actor, "earnings:own", { ownerUserId: actor.userId })) throw new ForbiddenError();
  const order = await loadStatementRow(orderId);
  const statement = order ? toStatement(order, actor.userId) : null;
  if (!statement) throw new NotFoundError("ORDER_NOT_FOUND");
  return statement;
}

/** The farmer's statements, newest first (the latest 100). */
export async function listOwnEarnings(actor: Actor): Promise<EarningsStatement[]> {
  if (!can(actor, "earnings:own", { ownerUserId: actor.userId })) throw new ForbiddenError();
  const orders = await prisma.order.findMany({
    where: { status: "COMPLETED", lot: { contributions: { some: { farmerUserId: actor.userId } } } },
    include: STATEMENT_INCLUDE,
    orderBy: [{ completedAt: "desc" }, { id: "asc" }],
    take: 100,
  });
  return orders.map((o) => toStatement(o, actor.userId)).filter((s): s is EarningsStatement => s !== null);
}
