import { ValidationError } from "@/lib/errors";

// Lot photos arrive already compressed by the browser (long edge 1600 px, JPEG quality 0.8),
// so 1 MB is generous; an uncompressed phone photo is refused rather than stored.
export const MAX_PHOTO_BYTES = 1_048_576;
export const PHOTO_TYPES = ["image/jpeg", "image/webp"] as const;
export const MAX_PHOTOS = 4;

function startsWith(body: Buffer, bytes: number[], offset = 0): boolean {
  return body.length >= offset + bytes.length && bytes.every((b, i) => body[offset + i] === b);
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

// The file's first bytes must match its declared type, so a renamed file is refused.
function matchesType(body: Buffer, contentType: string): boolean {
  if (contentType === "image/jpeg") return startsWith(body, [0xff, 0xd8, 0xff]);
  return startsWith(body, ascii("RIFF")) && startsWith(body, ascii("WEBP"), 8);
}

export function validatePhoto(photo: { body: Buffer; contentType: string }): void {
  if (!(PHOTO_TYPES as readonly string[]).includes(photo.contentType)) {
    throw new ValidationError("Photo type not allowed", "PHOTO_TYPE_NOT_ALLOWED");
  }
  if (photo.body.length > MAX_PHOTO_BYTES) {
    throw new ValidationError("Photo is too large", "PHOTO_TOO_LARGE");
  }
  if (!matchesType(photo.body, photo.contentType)) {
    throw new ValidationError("Photo contents do not match its type", "PHOTO_TYPE_MISMATCH");
  }
}
