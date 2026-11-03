import { describe, expect, it } from "vitest";
import { MAX_PHOTO_BYTES, validatePhoto } from "@/modules/catalog/photos";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("lot photos", () => {
  it("accepts JPEG and WebP whose contents match", () => {
    expect(() => validatePhoto({ body: JPEG, contentType: "image/jpeg" })).not.toThrow();
    expect(() => validatePhoto({ body: WEBP, contentType: "image/webp" })).not.toThrow();
  });

  it("refuses other types and contents that do not match", () => {
    expect(() => validatePhoto({ body: PNG, contentType: "image/png" })).toThrow(
      expect.objectContaining({ code: "PHOTO_TYPE_NOT_ALLOWED" }),
    );
    expect(() => validatePhoto({ body: PNG, contentType: "image/jpeg" })).toThrow(
      expect.objectContaining({ code: "PHOTO_TYPE_MISMATCH" }),
    );
  });

  it("refuses a photo over 1 MB", () => {
    expect(MAX_PHOTO_BYTES).toBe(1_048_576);
    const big = Buffer.concat([JPEG, Buffer.alloc(MAX_PHOTO_BYTES)]);
    expect(() => validatePhoto({ body: big, contentType: "image/jpeg" })).toThrow(
      expect.objectContaining({ code: "PHOTO_TOO_LARGE" }),
    );
  });
});
