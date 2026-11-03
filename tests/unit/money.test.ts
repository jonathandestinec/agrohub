import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  applyBps,
  effectiveCutBps,
  formatNaira,
  formatNairaChange,
  formatPercent,
  nairaInput,
  parseBps,
  percentToBps,
  saleBreakdown,
  splitByWeights,
  toKobo,
} from "@/lib/money";

describe("parseBps", () => {
  it("parses a stored setting string of integer basis points", () => {
    expect(parseBps("300")).toBe(300);
    expect(parseBps("0")).toBe(0);
    expect(parseBps("10000")).toBe(10000);
  });

  it("refuses anything that is not 0 to 10000 written as plain digits", () => {
    for (const bad of ["10001", "3.5", "", "-1", " 300", "3%", "1e3"]) {
      expect(() => parseBps(bad), bad).toThrow(RangeError);
    }
  });
});

describe("formatPercent", () => {
  it("shows basis points as a percentage without trailing zeros", () => {
    expect(formatPercent(300)).toBe("3%");
    expect(formatPercent(250)).toBe("2.5%");
    expect(formatPercent(1)).toBe("0.01%");
    expect(formatPercent(0)).toBe("0%");
  });
});

describe("percentToBps", () => {
  it("converts a percentage with up to two decimals to basis points", () => {
    expect(percentToBps("3")).toBe(300);
    expect(percentToBps("2.5")).toBe(250);
    expect(percentToBps("0.01")).toBe(1);
    expect(percentToBps("100")).toBe(10000);
  });

  it("refuses more than two decimals or non-numbers", () => {
    for (const bad of ["2.555", "", "abc", "-1"]) {
      expect(() => percentToBps(bad), bad).toThrow(SyntaxError);
    }
  });
});

describe("toKobo", () => {
  it("parses naira strings to integer kobo", () => {
    expect(toKobo("1500.50")).toBe(150050);
    expect(toKobo("1500.5")).toBe(150050);
    expect(toKobo("1500")).toBe(150000);
    expect(toKobo("1500.")).toBe(150000);
    expect(toKobo(".5")).toBe(50);
    expect(toKobo("0.07")).toBe(7);
    expect(toKobo("0")).toBe(0);
    expect(toKobo("19.99")).toBe(1999);
  });

  it("rejects more than two decimals", () => {
    expect(() => toKobo("1500.505")).toThrow();
    expect(() => toKobo("1.000")).toThrow();
  });

  it("rejects malformed input", () => {
    for (const bad of ["", " ", ".", "-1", "+1", "1e3", " 1", "1 ", "1,500", "abc", "1.2.3", "0x10"]) {
      expect(() => toKobo(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("rejects results beyond the safe integer range", () => {
    expect(() => toKobo("90071992547409.92")).toThrow();
    expect(toKobo("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("formatNaira", () => {
  it("formats kobo with naira sign, grouping and 2 decimals", () => {
    expect(formatNaira(150050)).toBe("₦1,500.50");
    expect(formatNaira(0)).toBe("₦0.00");
    expect(formatNaira(5)).toBe("₦0.05");
    expect(formatNaira(100)).toBe("₦1.00");
    expect(formatNaira(123456789)).toBe("₦1,234,567.89");
    expect(formatNaira(100000000)).toBe("₦1,000,000.00");
  });

  it("renders negatives with a leading minus", () => {
    expect(formatNaira(-150050)).toBe("-₦1,500.50");
    expect(formatNaira(-5)).toBe("-₦0.05");
  });

  it("throws on non-safe-integers", () => {
    expect(() => formatNaira(1.5)).toThrow();
    expect(() => formatNaira(NaN)).toThrow();
    expect(() => formatNaira(Infinity)).toThrow();
    expect(() => formatNaira(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  it("round-trips with toKobo", () => {
    expect(toKobo(formatNaira(150050).slice(1).replace(/,/g, ""))).toBe(150050);
  });
});

describe("applyBps", () => {
  it("applies basis points, rounding down", () => {
    expect(applyBps(100000, 1000)).toBe(10000);
    expect(applyBps(999, 1000)).toBe(99);
    expect(applyBps(0, 1000)).toBe(0);
    expect(applyBps(12345, 0)).toBe(0);
    expect(applyBps(12345, 10000)).toBe(12345);
    expect(applyBps(1, 9999)).toBe(0);
  });

  it("stays exact when kobo * bps exceeds the safe range", () => {
    // 2^53 - 1 = 9007199254740991; 10% floors to 900719925474099
    expect(applyBps(Number.MAX_SAFE_INTEGER, 1000)).toBe(900719925474099);
    expect(applyBps(Number.MAX_SAFE_INTEGER, 10000)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("throws on invalid input, including negative kobo", () => {
    expect(() => applyBps(-1, 1000)).toThrow();
    expect(() => applyBps(100, -1)).toThrow();
    expect(() => applyBps(1.5, 1000)).toThrow();
    expect(() => applyBps(100, 0.5)).toThrow();
    expect(() => applyBps(NaN, 1000)).toThrow();
    expect(() => applyBps(100, Infinity)).toThrow();
    expect(() => applyBps(Number.MAX_SAFE_INTEGER + 1, 1000)).toThrow();
  });
});

describe("splitByWeights", () => {
  it("splits with largest remainder, ties to the lower index", () => {
    expect(splitByWeights(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(splitByWeights(100, [3, 0, 1])).toEqual([75, 0, 25]);
    expect(splitByWeights(1000, [334, 333, 333])).toEqual([334, 333, 333]);
    expect(splitByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitByWeights(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });

  it("gives leftovers to the largest remainders, not just the first indexes", () => {
    // 7 over [1,2,7]: ideal 0.7, 1.4, 4.9 -> base 0,1,4; the 2 leftover go to remainders .9 then .7
    expect(splitByWeights(7, [1, 2, 7])).toEqual([1, 1, 5]);
  });

  it("handles zero total and single weight", () => {
    expect(splitByWeights(0, [1, 2])).toEqual([0, 0]);
    expect(splitByWeights(500, [7])).toEqual([500]);
  });

  it("never gives kobo to zero-weight parts", () => {
    expect(splitByWeights(1, [0, 1, 0])).toEqual([0, 1, 0]);
  });

  it("stays exact for large totals and weights", () => {
    const total = Number.MAX_SAFE_INTEGER;
    const parts = splitByWeights(total, [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    expect(parts.every(Number.isSafeInteger)).toBe(true);
  });

  it("throws on invalid input", () => {
    expect(() => splitByWeights(100, [0, 0])).toThrow();
    expect(() => splitByWeights(100, [])).toThrow();
    expect(() => splitByWeights(-1, [1])).toThrow();
    expect(() => splitByWeights(1.5, [1])).toThrow();
    expect(() => splitByWeights(100, [1, -1])).toThrow();
    expect(() => splitByWeights(100, [1, 0.5])).toThrow();
    expect(() => splitByWeights(100, [1, NaN])).toThrow();
    expect(() => splitByWeights(100, [Number.MAX_SAFE_INTEGER, 1])).not.toThrow();
  });

  it("split_always_sums_to_total", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.array(fc.integer({ min: 0, max: 1_000_000_000 }), { minLength: 1, maxLength: 12 }),
        (total, weights) => {
          fc.pre(weights.some((w) => w > 0));
          const parts = splitByWeights(total, weights);
          expect(parts).toHaveLength(weights.length);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
          parts.forEach((p, i) => {
            expect(Number.isSafeInteger(p) && p >= 0).toBe(true);
            if (weights[i] === 0) expect(p).toBe(0);
          });
        },
      ),
    );
  });
});

describe("saleBreakdown", () => {
  it("splits a sale into the cooperative cut, the AgroHub fee and the farmer's take-home", () => {
    // 30 bags at ₦64,850 with a 5% cut and a 3% fee.
    expect(saleBreakdown(6_485_000, 30, 500, 300)).toEqual({
      grossKobo: 194_550_000,
      cooperativeKobo: 9_727_500,
      feeKobo: 5_836_500,
      takeHomeKobo: 178_986_000,
      takeHomePerUnitKobo: 5_966_200,
    });
  });

  it("always adds back up to what the buyer pays", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 0, max: 5_000 }),
        (ask, qty, cut, fee) => {
          const b = saleBreakdown(ask, qty, cut, fee);
          expect(b.cooperativeKobo + b.feeKobo + b.takeHomeKobo).toBe(b.grossKobo);
        },
      ),
    );
  });
});

describe("formatNairaChange", () => {
  it("signs a rise and a fall and leaves no change unsigned", () => {
    expect(formatNairaChange(48000, 50000)).toBe("+₦20.00");
    expect(formatNairaChange(5_200_000, 5_100_000)).toBe("-₦1,000.00");
    expect(formatNairaChange(50000, 50000)).toBe("₦0.00");
  });
});

describe("effectiveCutBps", () => {
  it("uses the lower of the cooperative's cut and the current maximum", () => {
    expect(effectiveCutBps(400, 300)).toBe(300);
    expect(effectiveCutBps(200, 500)).toBe(200);
    expect(effectiveCutBps(500, 500)).toBe(500);
  });
});

describe("nairaInput", () => {
  it("writes kobo as a plain naira amount a form field and toKobo accept", () => {
    expect(nairaInput(6_500_000)).toBe("65000");
    expect(nairaInput(4_321_987)).toBe("43219.87");
    expect(nairaInput(50)).toBe("0.50");
    expect(toKobo(nairaInput(4_321_987))).toBe(4_321_987);
  });
});
