import { describe, expect, it } from "vitest";
import { DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_BYTES, matchesSignature } from "@/lib/file-type";

describe("matchesSignature", () => {
  it("accepts PDF bytes declared as a PDF", () => {
    expect(matchesSignature(Buffer.from("%PDF-1.4\n"), "application/pdf")).toBe(true);
  });

  it("refuses PNG bytes declared as a JPEG", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(matchesSignature(png, "image/jpeg")).toBe(false);
  });

  it("refuses a body shorter than the signature", () => {
    expect(matchesSignature(Buffer.from([0xff, 0xd8]), "image/jpeg")).toBe(false);
  });

  it("refuses a type outside the allowed list", () => {
    expect(matchesSignature(Buffer.from("GIF89a"), "image/gif")).toBe(false);
  });

  it("keeps the document limits", () => {
    expect(DOCUMENT_CONTENT_TYPES).toEqual(["application/pdf", "image/jpeg", "image/png"]);
    expect(MAX_DOCUMENT_BYTES).toBe(10_485_760);
  });
});
