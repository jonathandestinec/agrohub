import { describe, expect, it } from "vitest";
import { boardErrorKey } from "@/app/board/error-key";
import { currentWeekKey } from "@/modules/board/week";

describe("currentWeekKey", () => {
  it("rolls over at Monday 00:00 Lagos time", () => {
    expect(currentWeekKey(new Date("2026-11-08T22:59:00Z"))).toBe("2026-11-02");
    expect(currentWeekKey(new Date("2026-11-08T23:00:00Z"))).toBe("2026-11-09");
  });
});

describe("boardErrorKey", () => {
  it.each([
    "UNAUTHENTICATED",
    "2FA_REQUIRED",
    "FORBIDDEN",
    "CROP_NOT_FOUND",
    "UNIT_NOT_FOUND",
    "INVALID_WEEK",
  ])("gives %s its own message", (code) => {
    expect(boardErrorKey(code)).toBe(`errors.${code}`);
  });

  it("falls back to INTERNAL", () => {
    expect(boardErrorKey("SOMETHING_ELSE")).toBe("errors.INTERNAL");
  });
});
