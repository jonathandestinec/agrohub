import { describe, expect, it } from "vitest";
import { parseLotFilters } from "@/modules/catalog/search-schema";

describe("parseLotFilters", () => {
  it("reads naira prices into kobo and keeps a valid grade", () => {
    expect(parseLotFilters({ minPrice: "500", maxPrice: "1,200.50", grade: "A" })).toEqual({
      minPriceKobo: 50_000,
      maxPriceKobo: 120_050,
      grade: "A",
      sort: "newest",
      page: 1,
    });
  });

  it("drops values that are not valid instead of failing", () => {
    expect(
      parseLotFilters({ minPrice: "abc", grade: "Z", page: "-2", state: "Atlantis", minQuantity: "1.5", sort: "random" }),
    ).toEqual({ sort: "newest", page: 1 });
  });

  it("keeps a known state, crop, cooperative, quantity, sort and page", () => {
    expect(
      parseLotFilters({
        state: "Oyo",
        cropId: "crop-1",
        cooperativeId: "coop-1",
        minQuantity: "10",
        sort: "price_asc",
        page: "3",
      }),
    ).toEqual({
      state: "Oyo",
      cropId: "crop-1",
      cooperativeId: "coop-1",
      minQuantity: 10,
      sort: "price_asc",
      page: 3,
    });
  });

  it("takes the first of repeated values and ignores empty ones", () => {
    expect(parseLotFilters({ grade: ["B", "A"], cropId: "", minPrice: "" })).toEqual({
      grade: "B",
      sort: "newest",
      page: 1,
    });
  });
});

describe("parseLotFilters page", () => {
  it("keeps pages up to 500 and drops anything beyond", () => {
    expect(parseLotFilters({ page: "500" }).page).toBe(500);
    expect(parseLotFilters({ page: "501" }).page).toBe(1);
  });
});
