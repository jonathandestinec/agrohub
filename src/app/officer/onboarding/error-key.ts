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
] as const;

// Maps a server action error code to a key under officer.onboarding.errors.
export function errorKey(code: string): `errors.${(typeof KNOWN)[number] | "INTERNAL"}` {
  const known = KNOWN.find((k) => k === code);
  return `errors.${known ?? "INTERNAL"}`;
}
