import { describe, expect, it } from "vitest";
import { countLabel, quantityTitle, TILE_ITEMS } from "@/lib/summary";

describe("quantityTitle", () => {
  it("writes_quantity_unit_and_crop", () => {
    expect(quantityTitle(12, "Bag", "Maize")).toBe("12 Bag · Maize");
  });
});

describe("countLabel", () => {
  it("shows_small_counts_as_they_are", () => {
    expect(countLabel(0)).toBe("0");
    expect(countLabel(99)).toBe("99");
  });
  it("shows_99_plus_above_ninety_nine", () => {
    expect(countLabel(100)).toBe("99+");
    expect(countLabel(101)).toBe("99+");
  });
  it("keeps_three_items_per_tile", () => {
    expect(TILE_ITEMS).toBe(3);
  });
});
