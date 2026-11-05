const KNOWN = [
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
  "UNAUTHENTICATED",
  "FORBIDDEN",
] as const;

// Pure: the orders.errors message key for an action result code.
export function orderErrorKey(code: string): `errors.${(typeof KNOWN)[number] | "INTERNAL"}` {
  const known = KNOWN.find((k) => k === code);
  return `errors.${known ?? "INTERNAL"}`;
}
