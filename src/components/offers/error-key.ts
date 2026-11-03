const KNOWN = [
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
] as const;

// Pure: the offers.errors message key for an action result code.
export function offerErrorKey(code: string): `errors.${(typeof KNOWN)[number] | "INTERNAL"}` {
  const known = KNOWN.find((k) => k === code);
  return `errors.${known ?? "INTERNAL"}`;
}
