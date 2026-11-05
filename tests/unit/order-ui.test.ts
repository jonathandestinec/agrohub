import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orderErrorKey } from "@/components/orders/error-key";
import { BUYER_ORDER_TONE, buyerOrderStatusKey } from "@/components/orders/status";
import { BUYER_ORDER_STATUSES } from "@/modules/orders/service";

const en = JSON.parse(readFileSync("messages/en.json", "utf8")) as Record<string, unknown>;

function ordersMessage(key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en.orders);
}

// Every code startCheckout, quoteDelivery and the order actions can return.
const ORDER_CODES = [
  "INVALID_CHECKOUT",
  "INVALID_QUANTITY",
  "LOT_NOT_AVAILABLE",
  "OWN_COOPERATIVE_LOT",
  "BELOW_MIN_ORDER",
  "NOT_ENOUGH_STOCK",
  "OFFER_NOT_FOUND",
  "OFFER_NOT_PAYABLE",
  "LOT_TERMS_MISSING",
  "QUOTE_NOT_USABLE",
  "QUOTE_RANGE",
  "INVALID_AMOUNT",
  "NO_BUYER_THREAD",
  "PAYSTACK_UNAVAILABLE",
  "PAYSTACK_REFUSED",
  "ORDER_NOT_FOUND",
  "MESSAGE_HAS_CONTACT",
  "MESSAGE_MENTIONS_FLOOR",
  "MESSAGE_LENGTH",
  "MESSAGE_RATE_LIMIT",
  "ORDER_STATE",
  "DELIVERED_RANGE",
  "DELIVERY_DATE_RANGE",
  "PAYOUT_NOT_FOUND",
  "PAYOUT_NOT_FAILED",
  "PAYOUT_NOT_BLOCKED",
  "PAYOUT_STILL_PENDING",
  "PAYOUT_PAID_AT_PAYSTACK",
  "NO_RECIPIENT",
  "UNAUTHENTICATED",
  "FORBIDDEN",
];

describe("order screens", () => {
  it("maps every order error code to an English message", () => {
    for (const code of ORDER_CODES) {
      const key = orderErrorKey(code);
      expect(key, code).not.toBe("errors.INTERNAL");
      expect(typeof ordersMessage(key), code).toBe("string");
    }
    expect(orderErrorKey("SOMETHING_ELSE")).toBe("errors.INTERNAL");
    expect(typeof ordersMessage("errors.INTERNAL")).toBe("string");
  });

  it("labels and colours every buyer order status", () => {
    for (const status of BUYER_ORDER_STATUSES) {
      expect(typeof ordersMessage(buyerOrderStatusKey(status)), status).toBe("string");
      expect(BUYER_ORDER_TONE[status], status).toBeTruthy();
    }
  });

  it("never calls the held payment escrow, in any English message", () => {
    expect(readFileSync("messages/en.json", "utf8").toLowerCase()).not.toContain("escrow");
  });
});
