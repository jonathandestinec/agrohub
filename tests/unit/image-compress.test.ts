import { describe, expect, it } from "vitest";
import { fitWithin } from "@/lib/image-compress";

describe("fitWithin", () => {
  it("scales the long edge down to the limit and keeps the aspect ratio", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("never enlarges a small photo", () => {
    expect(fitWithin(1200, 1600, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(640, 480, 1600)).toEqual({ width: 640, height: 480 });
  });

  it("keeps a thin photo at least one pixel high", () => {
    const size = fitWithin(801, 3, 400);
    expect(size.width).toBe(400);
    expect(size.height).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(size.height)).toBe(true);
  });
});
