import { describe, expect, it } from "vitest";
import { demoBreakdown } from "@/app/demo/_lib/breakdown";

describe("demoBreakdown", () => {
  it("splits a sale into cooperative cut, AgroHub fee and farmer take-home", () => {
    // ₦64,850 per bag, 40 bags, 5% cooperative cut, 3% AgroHub fee.
    const b = demoBreakdown(6_485_000, 40, 500, 300);
    expect(b.grossKobo).toBe(259_400_000);
    expect(b.cooperativeKobo).toBe(12_970_000);
    expect(b.feeKobo).toBe(7_782_000);
    expect(b.takeHomeKobo).toBe(238_648_000);
    expect(b.takeHomePerUnitKobo).toBe(5_966_200);
  });

  it("always adds back up to the gross amount", () => {
    const b = demoBreakdown(333_333, 7, 475, 299);
    expect(b.cooperativeKobo + b.feeKobo + b.takeHomeKobo).toBe(b.grossKobo);
  });

  it("returns zeros for an empty quantity", () => {
    expect(demoBreakdown(6_485_000, 0, 500, 300).takeHomeKobo).toBe(0);
  });
});
