// Message error codes to keys under "messages.errors"; anything else is the generic error.
const KEYS: Record<string, string> = {
  MESSAGE_HAS_CONTACT: "hasContact",
  MESSAGE_MENTIONS_FLOOR: "mentionsFloor",
  MESSAGE_LENGTH: "length",
  MESSAGE_RATE_LIMIT: "rateLimit",
  THREAD_NOT_FOUND: "notFound",
  LOT_NOT_AVAILABLE: "lotNotAvailable",
  OWN_COOPERATIVE_LOT: "ownCooperative",
};

export function messageErrorKey(code: string): string {
  return KEYS[code] ?? "generic";
}
