import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buyerStatusLabelKey, BUYER_STATUS_TONE } from "@/components/offers/status";
import { offerErrorKey } from "@/components/offers/error-key";

const en = JSON.parse(readFileSync("messages/en.json", "utf8")) as Record<string, unknown>;

// The English string at offers.<key>, or undefined.
function offersMessage(key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en.offers);
}

const OFFER_CODES = [
  "INVALID_OFFER",
  "INVALID_PRICE",
  "LOT_NOT_AVAILABLE",
  "OWN_COOPERATIVE_LOT",
  "OFFER_ABOVE_ASK",
  "BELOW_MIN_ORDER",
  "OFFER_RATE_LIMIT",
  "OFFER_LOT_LIMIT",
  "NOT_ENOUGH_STOCK",
  "OFFER_NOT_FOUND",
  "OFFER_NOT_OPEN",
  "OFFER_NOT_COUNTERED",
  "OFFER_NOT_LIVE",
  "OFFER_NOT_AWAITING_FARMER",
  "OFFER_EXPIRED",
  "COUNTER_NOT_ABOVE_OFFER",
  "COUNTER_ABOVE_ASK",
  "COUNTER_BELOW_FLOOR",
  "MESSAGE_HAS_CONTACT",
  "MESSAGE_MENTIONS_FLOOR",
  "MESSAGE_LENGTH",
  "MESSAGE_RATE_LIMIT",
  "UNAUTHENTICATED",
  "FORBIDDEN",
];

describe("offerErrorKey", () => {
  it.each(OFFER_CODES)("maps %s to an English message", (code) => {
    const key = offerErrorKey(code);
    expect(key).toBe(`errors.${code}`);
    expect(typeof offersMessage(key)).toBe("string");
  });

  it("maps an unknown code to the generic message", () => {
    expect(offerErrorKey("SOMETHING_ELSE")).toBe("errors.INTERNAL");
    expect(typeof offersMessage("errors.INTERNAL")).toBe("string");
  });
});

describe("buyerStatusLabelKey", () => {
  it.each(["WAITING", "COUNTERED", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"] as const)(
    "labels %s and gives it a tone",
    (status) => {
      expect(typeof offersMessage(buyerStatusLabelKey(status))).toBe("string");
      expect(BUYER_STATUS_TONE[status]).toBeTruthy();
    },
  );
});
