const KNOWN = [
  "INVALID_LOT",
  "INVALID_PRICE",
  "FLOOR_ABOVE_ASK",
  "INVALID_AVAILABLE_UNTIL",
  "PHOTO_COUNT",
  "PHOTO_TYPE_NOT_ALLOWED",
  "PHOTO_TYPE_MISMATCH",
  "PHOTO_TOO_LARGE",
  "COOPERATIVE_NOT_VERIFIED",
  "BANK_ACCOUNT_REQUIRED",
  "CROP_INACTIVE",
  "UNIT_INACTIVE",
  "NOTE_REQUIRED",
  "LOT_NOT_FOUND",
  "LOT_NOT_PENDING",
  "CANNOT_APPROVE_OWN_LOT",
  "INVALID_MIN_ORDER",
  "REASON_REQUIRED",
  "COUNTER_BELOW_FLOOR",
  "COUNTER_SAME_AS_ASK",
  "LOT_NOT_COUNTERED",
  "LOT_NOT_LIVE",
  "QUANTITY_BELOW_MIN_ORDER",
  "REVISION_NOT_PENDING",
  "LOT_NOT_WITHDRAWABLE",
  "LOT_HAS_OPEN_ORDERS",
  "UNAUTHENTICATED",
  "2FA_REQUIRED",
  "FORBIDDEN",
] as const;

// Pure: the lots.errors message key for an action result code.
export function lotErrorKey(code: string): `errors.${(typeof KNOWN)[number] | "INTERNAL"}` {
  const known = KNOWN.find((k) => k === code);
  return `errors.${known ?? "INTERNAL"}`;
}
