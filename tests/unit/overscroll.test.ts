import { describe, expect, it } from "vitest";
import { resist } from "@/components/overscroll";

describe("resist", () => {
  it("does not move with no pull", () => {
    expect(resist(0, 160)).toBe(0);
  });

  it("follows a small pull almost one to one", () => {
    expect(resist(10, 160)).toBeGreaterThan(9.5);
    expect(resist(10, 160)).toBeLessThanOrEqual(10);
  });

  it("grows with the pull but never passes the limit", () => {
    expect(resist(400, 160)).toBeGreaterThan(resist(200, 160));
    expect(resist(100_000, 160)).toBeLessThanOrEqual(160);
  });

  it("treats a negative pull as none", () => {
    expect(resist(-50, 160)).toBe(0);
  });
});
