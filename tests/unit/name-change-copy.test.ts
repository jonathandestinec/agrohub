import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import { nameChangeErrorKey } from "@/app/account/name/error-key";

const CODES = [
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
];

function lookup(key: string): unknown {
  return key.split(".").reduce<unknown>(
    (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
    en.nameChange,
  );
}

describe("nameChangeErrorKey", () => {
  it.each(CODES)("maps %s to an English message", (code) => {
    const key = nameChangeErrorKey(code);
    expect(key).toBe(`errors.${code}`);
    expect(typeof lookup(key)).toBe("string");
  });

  it("falls back to INTERNAL", () => {
    expect(nameChangeErrorKey("SOMETHING_ELSE")).toBe("errors.INTERNAL");
    expect(typeof lookup("errors.INTERNAL")).toBe("string");
  });

  it("never calls anything escrow", () => {
    expect(JSON.stringify(en.nameChange).toLowerCase()).not.toContain("escrow");
  });
});
