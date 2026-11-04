import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@/generated/prisma/client";
import { assertTransition, canTransition, isFrozen, isOpenOrder } from "@/modules/orders/state";

const ALL: OrderStatus[] = [
  "PENDING_PAYMENT",
  "PAID_HELD",
  "PREPARING",
  "DELIVERED_MARKED",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
  "DISPUTED",
  "TIMED_OUT",
];

// Written out by hand, not derived from the implementation's table.
const LEGAL = new Set([
  "PENDING_PAYMENT>PAID_HELD",
  "PENDING_PAYMENT>CANCELLED",
  "PENDING_PAYMENT>REFUNDED",
  "CANCELLED>PAID_HELD",
  "CANCELLED>REFUNDED",
  "PAID_HELD>PREPARING",
  "PAID_HELD>DELIVERED_MARKED",
  "PAID_HELD>REFUNDED",
  "PAID_HELD>DISPUTED",
  "PAID_HELD>TIMED_OUT",
  "PREPARING>DELIVERED_MARKED",
  "PREPARING>REFUNDED",
  "PREPARING>DISPUTED",
  "PREPARING>TIMED_OUT",
  "DELIVERED_MARKED>COMPLETED",
  "DELIVERED_MARKED>DISPUTED",
  "DISPUTED>COMPLETED",
  "DISPUTED>REFUNDED",
  "TIMED_OUT>COMPLETED",
  "TIMED_OUT>REFUNDED",
  "TIMED_OUT>DELIVERED_MARKED",
]);

describe("order state machine", () => {
  const pairs = ALL.flatMap((from) => ALL.map((to) => ({ from, to, legal: LEGAL.has(`${from}>${to}`) })));

  it("has 81 rows", () => expect(pairs).toHaveLength(81));

  it.each(pairs)("$from -> $to is legal: $legal", ({ from, to, legal }) => {
    expect(canTransition(from, to)).toBe(legal);
  });

  it("refuses an illegal transition with ORDER_STATE", () => {
    expect(() => assertTransition("COMPLETED", "REFUNDED")).toThrow(expect.objectContaining({ code: "ORDER_STATE" }));
    expect(() => assertTransition("PAID_HELD", "PREPARING")).not.toThrow();
  });

  it("knows which orders are open and which are frozen", () => {
    expect(ALL.filter(isOpenOrder)).toEqual(["PAID_HELD", "PREPARING", "DELIVERED_MARKED", "DISPUTED", "TIMED_OUT"]);
    expect(ALL.filter(isFrozen)).toEqual(["DISPUTED", "TIMED_OUT"]);
  });
});
