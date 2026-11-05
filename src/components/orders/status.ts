import type { ChipTone } from "@/components/ui";
import type { OrderStatus } from "@/generated/prisma/client";
import type { BuyerOrderStatus } from "@/modules/orders/service";

// Pure: the orders.* message key for what a buyer sees of an order's status.
export function buyerOrderStatusKey(status: BuyerOrderStatus): `status.${BuyerOrderStatus}` {
  return `status.${status}`;
}

export const BUYER_ORDER_TONE: Record<BuyerOrderStatus, ChipTone> = {
  AWAITING_PAYMENT: "warn",
  PAYMENT_EXPIRED: "paper",
  PAID_HELD: "lime",
  PREPARING: "step",
  DELIVERED: "step",
  COMPLETED: "lime",
  CANCELLED: "paper",
  REFUNDED: "paper",
  UNDER_REVIEW: "warn",
};

// The cooperative sees the raw status.
export const OFFICER_ORDER_TONE: Record<OrderStatus, ChipTone> = {
  PENDING_PAYMENT: "paper",
  PAID_HELD: "lime",
  PREPARING: "step",
  DELIVERED_MARKED: "step",
  COMPLETED: "lime",
  CANCELLED: "paper",
  REFUNDED: "paper",
  DISPUTED: "warn",
  TIMED_OUT: "warn",
};
