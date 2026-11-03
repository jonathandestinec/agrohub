const KNOWN = [
  "CROP_EXISTS",
  "UNIT_EXISTS",
  "INVALID_NAME",
  "INVALID_KIND",
  "REQUEST_LIMIT",
  "REQUEST_NOT_FOUND",
  "REQUEST_NOT_OPEN",
  "REASON_REQUIRED",
  "ITEM_NOT_FOUND",
  "UNAUTHENTICATED",
  "2FA_REQUIRED",
  "FORBIDDEN",
] as const;

// Pure: the catalogRequests.errors message key for an action result code.
export function requestErrorKey(code: string): `errors.${(typeof KNOWN)[number] | "INTERNAL"}` {
  const known = KNOWN.find((k) => k === code);
  return `errors.${known ?? "INTERNAL"}`;
}
