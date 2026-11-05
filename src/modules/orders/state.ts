import type { OrderStatus } from "@/generated/prisma/client";
import { ConflictError } from "@/lib/errors";

// The order state machine (architecture section 6). A CANCELLED order can still become
// PAID_HELD or REFUNDED: only a payment that arrives after the unpaid order expired does that.
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ["PAID_HELD", "CANCELLED", "REFUNDED"],
  CANCELLED: ["PAID_HELD", "REFUNDED"],
  PAID_HELD: ["PREPARING", "DELIVERED_MARKED", "REFUNDED", "DISPUTED", "TIMED_OUT"],
  PREPARING: ["DELIVERED_MARKED", "REFUNDED", "DISPUTED", "TIMED_OUT"],
  DELIVERED_MARKED: ["COMPLETED", "DISPUTED"],
  DISPUTED: ["COMPLETED", "REFUNDED"],
  TIMED_OUT: ["COMPLETED", "REFUNDED", "DELIVERED_MARKED"],
  COMPLETED: [],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

// The error names neither an amount nor a party.
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new ConflictError("The order cannot do that now", "ORDER_STATE");
}

const OPEN: readonly OrderStatus[] = ["PAID_HELD", "PREPARING", "DELIVERED_MARKED", "DISPUTED", "TIMED_OUT"];

/** Paid and not yet finished: the money is still held. */
export function isOpenOrder(status: OrderStatus): boolean {
  return OPEN.includes(status);
}

/** Waiting for an admin: no buyer or cooperative action moves it. */
export function isFrozen(status: OrderStatus): boolean {
  return status === "DISPUTED" || status === "TIMED_OUT";
}
