import { describe, expect, it } from "vitest";
import { addDays, isDateKey, lagosDate, lagosDateKey } from "@/lib/lagos-date";

describe("Lagos calendar dates", () => {
  it("reads the date in Lagos time (UTC+1)", () => {
    expect(lagosDateKey(new Date("2026-11-03T23:30:00Z"))).toBe("2026-11-04");
    expect(lagosDateKey(new Date("2026-11-03T22:59:00Z"))).toBe("2026-11-03");
  });

  it("turns a date key into midnight UTC of that date, for date columns", () => {
    expect(lagosDate("2026-11-04").toISOString()).toBe("2026-11-04T00:00:00.000Z");
  });

  it("adds whole days to a date key", () => {
    expect(addDays("2026-11-04", 90)).toBe("2027-02-02");
    expect(addDays("2026-11-04", -1)).toBe("2026-11-03");
  });
});

describe("isDateKey", () => {
  it("accepts only real calendar dates", () => {
    expect(isDateKey("2026-11-04")).toBe(true);
    for (const bad of ["2026-13-01", "2026-02-30", "soon", "2026-1-4", 20261104]) {
      expect(isDateKey(bad), String(bad)).toBe(false);
    }
  });
});
