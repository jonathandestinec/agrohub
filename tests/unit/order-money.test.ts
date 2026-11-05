import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MAX_TRANSFER_KOBO,
  koboFromDb,
  koboToDb,
  orderSplit,
  refundForUnits,
  splitTransferParts,
} from "@/lib/money";

describe("orderSplit", () => {
  const rows = [
    {
      input: { unitKobo: 6_500_000, quantity: 30, cutBps: 500, feeBps: 300, deliveryKobo: 2_500_000, contributions: [30] },
      goods: 195_000_000, cut: 9_750_000, fee: 5_850_000, farmers: [179_400_000], coop: 12_250_000, total: 197_500_000,
    },
    {
      input: { unitKobo: 6_500_000, quantity: 25, cutBps: 500, feeBps: 300, deliveryKobo: 2_500_000, contributions: [30] },
      goods: 162_500_000, cut: 8_125_000, fee: 4_875_000, farmers: [149_500_000], coop: 10_625_000, total: 165_000_000,
    },
    {
      input: { unitKobo: 33_333, quantity: 7, cutBps: 250, feeBps: 300, deliveryKobo: 0, contributions: [3, 4] },
      goods: 233_331, cut: 5_833, fee: 6_999, farmers: [94_500, 125_999], coop: 5_833, total: 233_331,
    },
    {
      input: { unitKobo: 50_000_000, quantity: 100, cutBps: 0, feeBps: 300, deliveryKobo: 0, contributions: [100] },
      goods: 5_000_000_000, cut: 0, fee: 150_000_000, farmers: [4_850_000_000], coop: 0, total: 5_000_000_000,
    },
  ];

  it.each(rows)("splits $input.quantity at $input.unitKobo exactly", (row) => {
    const split = orderSplit(row.input);
    expect(split).toEqual({
      goodsKobo: row.goods,
      deliveryKobo: row.input.deliveryKobo,
      totalKobo: row.total,
      cutKobo: row.cut,
      feeKobo: row.fee,
      cooperativePayoutKobo: row.coop,
      farmerKobo: row.farmers,
    });
    const farmers = split.farmerKobo.reduce((a, b) => a + b, 0);
    expect(split.cooperativePayoutKobo + split.feeKobo + farmers).toBe(split.totalKobo);
  });

  it("a shortfall of 5 units is exactly the refund for those units", () => {
    expect(refundForUnits(6_500_000, 5)).toBe(32_500_000);
    expect(orderSplit(rows[0].input).totalKobo - refundForUnits(6_500_000, 5)).toBe(rows[1].total);
  });

  it("refuses an order with no contributions", () => {
    expect(() =>
      orderSplit({ unitKobo: 100, quantity: 1, cutBps: 0, feeBps: 0, deliveryKobo: 0, contributions: [] }),
    ).toThrow(RangeError);
  });

  it("payouts plus fee always equal the total", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 5 }),
        (unitKobo, quantity, cutBps, feeBps, deliveryKobo, contributions) => {
          const split = orderSplit({ unitKobo, quantity, cutBps, feeBps, deliveryKobo, contributions });
          const farmers = split.farmerKobo.reduce((a, b) => a + b, 0);
          return split.cooperativePayoutKobo + split.feeKobo + farmers === split.totalKobo;
        },
      ),
    );
  });
});

describe("splitTransferParts", () => {
  it("caps each transfer at ₦10,000,000", () => {
    expect(MAX_TRANSFER_KOBO).toBe(1_000_000_000);
    expect(splitTransferParts(4_850_000_000)).toEqual([970_000_000, 970_000_000, 970_000_000, 970_000_000, 970_000_000]);
    expect(splitTransferParts(1_000_000_001)).toEqual([500_000_001, 500_000_000]);
    expect(splitTransferParts(1_000_000_000)).toEqual([1_000_000_000]);
    expect(splitTransferParts(0)).toEqual([]);
  });

  it("parts never pass the cap and always sum to the amount", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000_000 }), (kobo) => {
        const parts = splitTransferParts(kobo);
        return parts.every((p) => p > 0 && p <= MAX_TRANSFER_KOBO) && parts.reduce((a, b) => a + b, 0) === kobo;
      }),
    );
  });
});

describe("BIGINT kobo", () => {
  it("reads and writes order amounts above the 32-bit limit exactly", () => {
    expect(koboFromDb(BigInt("5000000000"))).toBe(5_000_000_000);
    expect(koboToDb(5_000_000_000)).toBe(BigInt("5000000000"));
    expect(() => koboFromDb(BigInt(2) ** BigInt(60))).toThrow(RangeError);
    expect(() => koboToDb(-1)).toThrow(RangeError);
    expect(() => koboToDb(1.5)).toThrow(RangeError);
  });
});

describe("sumKobo", () => {
  it("adds safe kobo amounts exactly and refuses anything else", async () => {
    const { sumKobo } = await import("@/lib/money");
    expect(sumKobo(65_000_000, 2_500_000)).toBe(67_500_000);
    expect(sumKobo()).toBe(0);
    expect(() => sumKobo(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
    expect(() => sumKobo(-1)).toThrow(RangeError);
    expect(() => sumKobo(1.5)).toThrow(RangeError);
  });
});
