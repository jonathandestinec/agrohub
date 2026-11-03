const KNOWN_ERRORS = [
  "CROP_EXISTS",
  "UNIT_EXISTS",
  "INVALID_NAME",
  "FUTURE_WEEK",
  "CROP_INACTIVE",
  "UNIT_INACTIVE",
  "INVALID_PRICE",
  "INVALID_PRICE_ENTRY",
] as const;

// Pure: the board.errors message key for an action result code.
export function boardErrorKey(code: string): `errors.${(typeof KNOWN_ERRORS)[number] | "INTERNAL"}` {
  const known = KNOWN_ERRORS.find((k) => k === code);
  return `errors.${known ?? "INTERNAL"}`;
}
