import { describe, expect, it } from "vitest";
import { shouldRefreshOnFocus } from "@/lib/live/focus";

describe("shouldRefreshOnFocus", () => {
  it("refreshes when the page was last refreshed at least the minimum gap ago", () => {
    expect(shouldRefreshOnFocus(0, 60_000, 60_000)).toBe(true);
    expect(shouldRefreshOnFocus(0, 600_000, 60_000)).toBe(true);
  });

  it("does not refresh again within the minimum gap, however often the tab is focused", () => {
    expect(shouldRefreshOnFocus(0, 59_999, 60_000)).toBe(false);
    expect(shouldRefreshOnFocus(1_000, 1_001, 60_000)).toBe(false);
  });

  it("treats a clock that went backwards as too soon", () => {
    expect(shouldRefreshOnFocus(100_000, 50_000, 60_000)).toBe(false);
  });
});
