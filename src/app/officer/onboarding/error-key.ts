const KNOWN = [
  "ALREADY_OFFICER",
  "REGISTRATION_NUMBER_TAKEN",
  "VALIDATION_ERROR",
  "FILE_TYPE_NOT_ALLOWED",
  "FILE_TYPE_MISMATCH",
  "FILE_TOO_LARGE",
  "NO_FILE",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "ACCOUNT_NAME_MISMATCH",
  "BANK_ACCOUNT_NOT_FOUND",
  "UNKNOWN_BANK",
  "INVALID_ACCOUNT_NUMBER",
  "INVALID_BANK_CODE",
  "CERTIFICATE_EXPIRY_INVALID",
  "ILLEGAL_TRANSITION",
  "COOPERATIVE_NOT_FOUND",
  "INVALID_CUT",
  "CUT_ABOVE_MAXIMUM",
] as const;

// Maps a server action error code to a key under officer.onboarding.errors.
export function errorKey(code: string): `errors.${(typeof KNOWN)[number] | "INTERNAL"}` {
  const known = KNOWN.find((k) => k === code);
  return `errors.${known ?? "INTERNAL"}`;
}
