// Uploaded documents (cooperative verification, name changes): what is accepted and how
// the bytes are checked. The declared contentType alone is never trusted.

export const DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export const MAX_DOCUMENT_BYTES = 10_485_760;

// First bytes of each allowed type.
const SIGNATURES: Record<(typeof DOCUMENT_CONTENT_TYPES)[number], number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46], // %PDF
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
};

export function matchesSignature(body: Buffer, contentType: string): boolean {
  const signature = SIGNATURES[contentType as keyof typeof SIGNATURES];
  return (
    signature !== undefined &&
    body.length >= signature.length &&
    signature.every((byte, i) => body[i] === byte)
  );
}
