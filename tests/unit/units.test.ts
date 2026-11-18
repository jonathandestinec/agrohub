import { describe, expect, it } from "vitest";
import { unitLabel } from "@/lib/units";

describe("unitLabel", () => {
  it("keeps_one_singular_and_lowercases", () => {
    expect(unitLabel("Bag", 1)).toBe("bag");
    expect(unitLabel("100kg bag", 1)).toBe("100kg bag");
  });

  it("adds_s_for_other_quantities_including_zero_and_fractions", () => {
    expect(unitLabel("Bag", 50)).toBe("bags");
    expect(unitLabel("Tonne", 2)).toBe("tonnes");
    expect(unitLabel("Tuber", 0)).toBe("tubers");
    expect(unitLabel("Bag", 1.5)).toBe("bags");
  });

  it("pluralises_only_the_last_word_of_the_seed_units", () => {
    expect(unitLabel("100kg bag", 3)).toBe("100kg bags");
    expect(unitLabel("50kg basket", 2)).toBe("50kg baskets");
    expect(unitLabel("25kg basket", 10)).toBe("25kg baskets");
  });

  it("leaves_measure_symbols_alone", () => {
    expect(unitLabel("kg", 50)).toBe("kg");
    expect(unitLabel("KG", 50)).toBe("kg");
    expect(unitLabel("litre", 5)).toBe("litres");
  });

  it("handles_odd_endings_and_names_that_are_already_plural", () => {
    expect(unitLabel("Box", 2)).toBe("boxes");
    expect(unitLabel("Bunch", 2)).toBe("bunches");
    expect(unitLabel("Carry", 2)).toBe("carries");
    expect(unitLabel("Tray", 2)).toBe("trays");
    expect(unitLabel("Bags", 2)).toBe("bags");
    expect(unitLabel("  Sack ", 4)).toBe("sacks");
  });

  it("returns_an_empty_string_for_an_empty_name", () => {
    expect(unitLabel("", 3)).toBe("");
  });
});
