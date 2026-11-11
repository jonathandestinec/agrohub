import { describe, expect, it } from "vitest";
import { groupSchedule, scheduleWindow, SCHEDULE_DAYS, type DeliveryRow } from "@/modules/orders/schedule";

const row = (id: string, date: string): DeliveryRow => ({ id, date, href: `/officer/orders/${id}`, title: "2 Bag · Maize" });

describe("groupSchedule", () => {
  it("puts_past_dates_in_overdue", () => {
    const grouped = groupSchedule([row("a", "2026-11-09"), row("b", "2026-11-10"), row("c", "2026-11-11")], "2026-11-11");
    expect(grouped.overdue.map((r) => r.id)).toEqual(["a", "b"]);
    expect(grouped.days.map((d) => d.date)).toEqual(["2026-11-11"]);
  });

  it("groups_days_in_order", () => {
    const grouped = groupSchedule(
      [row("c", "2026-11-14"), row("a", "2026-11-12"), row("b", "2026-11-12")],
      "2026-11-11",
    );
    expect(grouped.overdue).toEqual([]);
    expect(grouped.days.map((d) => [d.date, d.orders.map((o) => o.id)])).toEqual([
      ["2026-11-12", ["a", "b"]],
      ["2026-11-14", ["c"]],
    ]);
  });

  it("leaves_out_empty_days", () => {
    const grouped = groupSchedule([row("a", "2026-11-11"), row("b", "2026-11-20")], "2026-11-11");
    expect(grouped.days.map((d) => d.date)).toEqual(["2026-11-11", "2026-11-20"]);
  });

  it("returns_nothing_for_no_rows", () => {
    expect(groupSchedule([], "2026-11-11")).toEqual({ overdue: [], days: [] });
  });
});

describe("scheduleWindow", () => {
  it("ends_on_the_fourteenth_day", () => {
    expect(SCHEDULE_DAYS).toBe(14);
    expect(scheduleWindow(new Date("2026-11-11T10:00:00Z"))).toEqual({ todayKey: "2026-11-11", lastKey: "2026-11-24" });
  });

  it("crosses_a_month_end", () => {
    expect(scheduleWindow(new Date("2026-11-25T10:00:00Z"))).toEqual({ todayKey: "2026-11-25", lastKey: "2026-12-08" });
  });

  it("treats_lagos_today_as_today_after_utc_midnight", () => {
    // 23:30 UTC is 00:30 the next day in Lagos.
    const { todayKey, lastKey } = scheduleWindow(new Date("2026-11-11T23:30:00Z"));
    expect(todayKey).toBe("2026-11-12");
    expect(lastKey).toBe("2026-11-25");
    const grouped = groupSchedule([row("today", "2026-11-12"), row("yesterday", "2026-11-11")], todayKey);
    expect(grouped.overdue.map((r) => r.id)).toEqual(["yesterday"]);
    expect(grouped.days.map((d) => d.date)).toEqual(["2026-11-12"]);
  });
});
