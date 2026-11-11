import type { DeliveryMethod, OrderStatus } from "@/generated/prisma/client";
import { formatNaira, koboFromDb } from "@/lib/money";
import { quantityTitle, type TileItem } from "@/lib/summary";

// What a buyer may know about an order's state. Disputed and timed-out orders both read
// UNDER_REVIEW; an unpaid order whose 15 minutes passed reads PAYMENT_EXPIRED.
export type BuyerOrderStatus =
  | "AWAITING_PAYMENT"
  | "PAYMENT_EXPIRED"
  | "PAID_HELD"
  | "PREPARING"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED"
  | "REFUNDED"
  | "UNDER_REVIEW";

export const BUYER_ORDER_STATUSES: readonly BuyerOrderStatus[] = [
  "AWAITING_PAYMENT",
  "PAYMENT_EXPIRED",
  "PAID_HELD",
  "PREPARING",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
  "UNDER_REVIEW",
];

// Pure.
export function buyerOrderStatusOf(
  status: OrderStatus,
  cancelReason: string | null,
  reservedUntil: Date | null,
  now: Date,
): BuyerOrderStatus {
  switch (status) {
    case "PENDING_PAYMENT":
      return reservedUntil && reservedUntil > now ? "AWAITING_PAYMENT" : "PAYMENT_EXPIRED";
    case "CANCELLED":
      return cancelReason === "PAYMENT_EXPIRED" || cancelReason === "REPLACED" ? "PAYMENT_EXPIRED" : "CANCELLED";
    case "PAID_HELD":
      return "PAID_HELD";
    case "PREPARING":
      return "PREPARING";
    case "DELIVERED_MARKED":
      return "DELIVERED";
    case "COMPLETED":
      return "COMPLETED";
    case "REFUNDED":
      return "REFUNDED";
    case "DISPUTED":
    case "TIMED_OUT":
      return "UNDER_REVIEW";
  }
}

export type OrderLotSummary = { id: string; crop: string; unit: string; cooperativeName: string };

export type BuyerOrder = {
  id: string;
  reference: string;
  lot: OrderLotSummary;
  quantity: number;
  deliveredQuantity: number | null;
  unitKobo: number;
  goodsKobo: number;
  deliveryMethod: DeliveryMethod;
  deliveryKobo: number;
  totalKobo: number;
  refundedKobo: number;
  status: BuyerOrderStatus;
  reservedUntil: string | null;
  deliveryDate: string | null;
  createdAt: string;
  paidAt: string | null;
  threadId: string | null;
  // The buyer asked to cancel an order being prepared; the cooperative has not answered yet.
  cancelRequested: boolean;
};

export type OrderRowForView = {
  id: string;
  quantity: number;
  deliveredQuantity: number | null;
  unitKobo: number;
  deliveryMethod: DeliveryMethod;
  deliveryKobo: bigint;
  totalKobo: bigint;
  status: OrderStatus;
  cancelReason: string | null;
  deliveryDate: Date | null;
  createdAt: Date;
  paidAt: Date | null;
  cancelRequestedAt: Date | null;
  reservation: { expiresAt: Date } | null;
  refunds: Array<{ amountKobo: bigint; status: string }>;
};

/** The short reference a person reads and quotes: the last 8 characters of the id, upper case. */
export function orderReference(orderId: string): string {
  return orderId.slice(-8).toUpperCase();
}

// Built field by field: no farmer identity, floor or bank data can reach a buyer.
export function toBuyerOrder(row: OrderRowForView, lot: OrderLotSummary, threadId: string | null, now: Date): BuyerOrder {
  const deliveryKobo = koboFromDb(row.deliveryKobo);
  const totalKobo = koboFromDb(row.totalKobo);
  const reservedUntil = row.status === "PENDING_PAYMENT" ? (row.reservation?.expiresAt ?? null) : null;
  return {
    id: row.id,
    reference: orderReference(row.id),
    lot: { id: lot.id, crop: lot.crop, unit: lot.unit, cooperativeName: lot.cooperativeName },
    quantity: row.quantity,
    deliveredQuantity: row.deliveredQuantity,
    unitKobo: row.unitKobo,
    goodsKobo: totalKobo - deliveryKobo,
    deliveryMethod: row.deliveryMethod,
    deliveryKobo,
    totalKobo,
    refundedKobo: row.refunds
      .filter((r) => r.status !== "FAILED")
      .reduce((sum, r) => sum + koboFromDb(r.amountKobo), 0),
    status: buyerOrderStatusOf(row.status, row.cancelReason, reservedUntil, now),
    reservedUntil: reservedUntil && reservedUntil > now ? reservedUntil.toISOString() : null,
    deliveryDate: row.deliveryDate ? row.deliveryDate.toISOString().slice(0, 10) : null,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    threadId,
    cancelRequested: row.cancelRequestedAt !== null && row.status === "PREPARING",
  };
}

// What the cooperative sees of an order: the buyer's name (never their email or phone), the raw
// status, the cut and fee from the copied terms, and each farmer's share (names only).
export type OfficerOrder = BuyerOrder & {
  buyerName: string;
  orderStatus: OrderStatus;
  cutKobo: number;
  feeKobo: number;
  farmerShares: Array<{ farmerName: string; quantity: number; amountKobo: number }>;
};

export function toOfficerOrder(
  buyer: BuyerOrder,
  input: {
    buyerName: string;
    orderStatus: OrderStatus;
    cutKobo: number;
    feeKobo: number;
    farmerShares: Array<{ farmerName: string; quantity: number; amountKobo: number }>;
  },
): OfficerOrder {
  return {
    ...buyer,
    buyerName: input.buyerName,
    orderStatus: input.orderStatus,
    cutKobo: input.cutKobo,
    feeKobo: input.feeKobo,
    farmerShares: input.farmerShares.map((s) => ({ farmerName: s.farmerName, quantity: s.quantity, amountKobo: s.amountKobo })),
  };
}

// A tile item for the farmer's earnings: what they take home from one completed sale, which is
// their own money and the only amount a farmer's home shows.
export function toEarningsTileItem(statement: {
  orderId: string;
  completedAt: string;
  crop: string;
  unit: string;
  contributedQuantity: number;
  takeHomeKobo: number;
}): TileItem {
  return {
    id: statement.orderId,
    href: `/farmer/earnings/${statement.orderId}`,
    title: quantityTitle(statement.contributedQuantity, statement.unit, statement.crop),
    detail: formatNaira(statement.takeHomeKobo),
    date: statement.completedAt,
  };
}

// A tile item for an order: quantity, unit and crop, plus the buyer's name for the cooperative.
// Never an amount (the buyer's receipts tile adds their own total) or contact detail.
export function toOrderTileItem(
  row: { id: string; quantity: number; lot: { crop: { name: string }; unit: { name: string } } },
  href: string,
  extra: { detail?: string; date?: Date | string | null; label?: string } = {},
): TileItem {
  const date = extra.date instanceof Date ? extra.date.toISOString() : extra.date;
  return {
    id: row.id,
    href,
    title: quantityTitle(row.quantity, row.lot.unit.name, row.lot.crop.name),
    ...(extra.detail ? { detail: extra.detail } : {}),
    ...(date ? { date } : {}),
    ...(extra.label ? { label: extra.label } : {}),
  };
}

const DISPUTE_KINDS = ["REPORT", "TIMEOUT", "SUSPENSION", "AFTER_COMPLETION"];

// A tile item for an open dispute: the order's quantity, unit and crop and what kind of problem.
// The reason text the buyer wrote stays on the dispute.
export function toDisputeTileItem(row: {
  id: string;
  kind: string;
  orderId: string;
  createdAt: Date;
  order: { quantity: number; lot: { crop: { name: string }; unit: { name: string } } };
}): TileItem {
  return {
    ...toOrderTileItem({ id: row.id, quantity: row.order.quantity, lot: row.order.lot }, `/admin/orders/${row.orderId}`, {
      date: row.createdAt,
      ...(DISPUTE_KINDS.includes(row.kind) ? { label: `admin.orders.kind.${row.kind}` } : {}),
    }),
  };
}
