const KNOWN = [
  "VALIDATION_ERROR",
  "ALREADY_IN_COOPERATIVE",
  "REMOVED_FROM_COOPERATIVE",
  "UNFINISHED_ORDERS",
  "ILLEGAL_TRANSITION",
  "INVITE_INVALID",
  "INVITE_EMAIL_MISMATCH",
  "COOPERATIVE_NOT_VERIFIED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "ACCOUNT_NAME_MISMATCH",
  "BANK_ACCOUNT_NOT_FOUND",
  "UNKNOWN_BANK",
  "INVALID_ACCOUNT_NUMBER",
  "INVALID_BANK_CODE",
  "CROP_INACTIVE",
  "INVALID_CROPS",
] as const;

// Maps a server action error code to a key under farmer.errors.
export function errorKey(code: string): `errors.${(typeof KNOWN)[number] | "INTERNAL"}` {
  const known = KNOWN.find((k) => k === code);
  return `errors.${known ?? "INTERNAL"}`;
}
