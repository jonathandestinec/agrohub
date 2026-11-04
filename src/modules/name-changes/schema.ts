import type { NameDocumentKind } from "@/generated/prisma/client";
import { ValidationError } from "@/lib/errors";

export const PERSON_DOCUMENT_KINDS = [
  "AFFIDAVIT",
  "MARRIAGE_CERTIFICATE",
  "PUBLIC_NOTICE",
] as const satisfies readonly NameDocumentKind[];

export const COOPERATIVE_DOCUMENT_KINDS = [
  "AMENDED_REGISTRATION_CERTIFICATE",
] as const satisfies readonly NameDocumentKind[];

export type NameChangeFile = { kind: NameDocumentKind; body: Buffer; contentType: string };
export type NameChangeInput = { newName: string; reason: string };

const NAME_MIN = 2;
const NAME_MAX = 120;
const REQUEST_REASON_MIN = 10;
const REASON_MAX = 500;
const REJECTION_REASON_MIN = 3;

// Trims and collapses runs of whitespace. A name must have a letter in it.
export function cleanName(raw: string): string {
  const name = (typeof raw === "string" ? raw : "").trim().replace(/\s+/g, " ");
  if (name.length < NAME_MIN || name.length > NAME_MAX || !/\p{L}/u.test(name)) {
    throw new ValidationError("Enter a name of 2 to 120 characters", "INVALID_NAME");
  }
  return name;
}

function cleanReason(raw: string, min: number): string {
  const reason = (typeof raw === "string" ? raw : "").trim();
  if (reason.length < min) throw new ValidationError("A reason is required", "REASON_REQUIRED");
  if (reason.length > REASON_MAX) throw new ValidationError("Reason is too long", "REASON_TOO_LONG");
  return reason;
}

export function cleanRequestReason(raw: string): string {
  return cleanReason(raw, REQUEST_REASON_MIN);
}

export function cleanRejectionReason(raw: string): string {
  return cleanReason(raw, REJECTION_REASON_MIN);
}
