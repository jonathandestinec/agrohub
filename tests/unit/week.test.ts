import { describe, expect, it } from "vitest";
import { toWeekKey, weekStart } from "@/modules/board/week";

describe("weekStart (Lagos, Monday)", () => {
  it("keeps Sunday 23:30 Lagos time in that week", () => {
    expect(toWeekKey(weekStart(new Date("2026-11-08T22:30:00Z")))).toBe("2026-11-02");
  });

  it("moves Monday 00:30 Lagos time into the new week", () => {
    expect(toWeekKey(weekStart(new Date("2026-11-08T23:30:00Z")))).toBe("2026-11-09");
  });

  it("maps a Wednesday to its Monday at UTC midnight", () => {
    const start = weekStart(new Date("2026-11-04T12:00:00Z"));
    expect(start.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });
});
