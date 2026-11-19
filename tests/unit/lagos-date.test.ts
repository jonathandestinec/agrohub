import { describe, expect, it } from "vitest";
import { addDays, formatLagosWat, isDateKey, lagosDate, lagosDateKey } from "@/lib/lagos-date";

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

describe("formatLagosWat", () => {
  it("shows Lagos wall-clock time with a literal WAT, never GMT+1", () => {
    expect(formatLagosWat(new Date("2031-06-12T12:00:00Z"))).toBe("12 Jun 2031, 13:00 WAT");
    expect(formatLagosWat(new Date("2026-11-18T20:15:00Z"))).toBe("18 Nov 2026, 21:15 WAT");
  });

  it("rolls over midnight into the next Lagos day", () => {
    expect(formatLagosWat(new Date("2026-11-03T23:30:00Z"))).toBe("4 Nov 2026, 00:30 WAT");
  });

  it("follows the locale's order for the date but keeps the WAT suffix", () => {
    const text = formatLagosWat(new Date("2031-06-12T12:00:00Z"), "en-US");
    expect(text).toMatch(/Jun 12, 2031/);
    expect(text.endsWith(" WAT")).toBe(true);
    expect(text).not.toContain("GMT");
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
