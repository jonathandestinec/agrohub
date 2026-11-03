import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_DEVIATION_THRESHOLD_BPS, priceDeviation } from "@/modules/board/deviation";

describe("priceDeviation", () => {
  it("defaults to a 20% threshold", () => {
    expect(DEFAULT_DEVIATION_THRESHOLD_BPS).toBe(2000);
  });

  it.each([
    [120000, 100000, 2000, "OK"],
    [120001, 100000, 2000, "HIGH"],
    [80000, 100000, 2000, "OK"],
    [79999, 100000, 2000, "LOW"],
    [100000, 100000, 2000, "OK"],
    [1, 100000, 0, "LOW"],
    [100000, 100000, 0, "OK"],
  ] as const)("ask %i against board %i at %i bps -> %s", (ask, boardKobo, bps, expected) => {
    expect(priceDeviation(ask, boardKobo, bps)).toBe(expected);
  });

  it("rejects a zero board price and non-integer or negative inputs", () => {
    expect(() => priceDeviation(100, 0, 2000)).toThrow(RangeError);
    expect(() => priceDeviation(1.5, 100, 2000)).toThrow(RangeError);
    expect(() => priceDeviation(-1, 100, 2000)).toThrow(RangeError);
    expect(() => priceDeviation(100, 100, -1)).toThrow(RangeError);
  });

  it("is always OK when the ask equals the board price", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 0, max: 10000 }),
        (kobo, bps) => priceDeviation(kobo, kobo, bps) === "OK",
      ),
    );
  });
});
