const KNOWN = [
  "INVALID_NAME",
  "NAME_UNCHANGED",
  "REASON_REQUIRED",
  "REASON_TOO_LONG",
  "INVALID_DOCUMENT_KIND",
  "FILE_TYPE_NOT_ALLOWED",
  "FILE_TYPE_MISMATCH",
  "FILE_TOO_LARGE",
  "NO_FILE",
  "BANK_CHANGE_OPEN",
  "NAME_CHANGE_ALREADY_PENDING",
  "NAME_CHANGE_NOT_PENDING",
  "COOPERATIVE_NOT_VERIFIED",
  "FORBIDDEN",
  "UNAUTHENTICATED",
] as const;

// Maps a server action error code to a key under nameChange.errors.
export function nameChangeErrorKey(code: string): `errors.${(typeof KNOWN)[number] | "INTERNAL"}` {
  const known = KNOWN.find((k) => k === code);
  return `errors.${known ?? "INTERNAL"}`;
}
