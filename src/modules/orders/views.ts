import type { DeliveryMethod, OrderStatus } from "@/generated/prisma/client";
import { koboFromDb } from "@/lib/money";

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
  };
}
