// Photo compression in the browser, before upload (spec 9: photos compressed on upload).
// Plain <canvas>, no dependency. fitWithin is pure so it can be tested without a browser.

/** The size that fits within maxEdge on the long side, keeping the aspect; never enlarges. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Re-encodes a photo as JPEG whose long edge is at most maxEdge pixels. Browser only.
 * The result is usually 100 to 400 KB, well under the server's 1 MB limit.
 */
export async function compressImage(file: File, maxEdge = 1600, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not compress the photo"))),
      "image/jpeg",
      quality,
    );
  });
}
