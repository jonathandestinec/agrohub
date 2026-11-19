import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { addDays, lagosDate, lagosDateKey } from "@/lib/lagos-date";
import { approveLot, submitLot } from "@/modules/catalog/service";
import { deliverySchedule, officerAttentionSummary, ordersToPrepareSummary, SCHEDULE_ROWS } from "@/modules/orders/service";
import { cleanDatabase, createTestCooperative } from "./helpers";
import { buyerMember, lotWorld, NOW, officerMember, PHOTO, type LotWorld } from "./lot-fixtures";
import { seedOrder } from "./order-fixtures";

const TODAY = lagosDateKey(NOW);

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
});

afterAll(cleanDatabase);

async function setup() {
  const w: LotWorld = await lotWorld();
  const lot = await submitLot(w.farmer, w.input({ quantity: 500 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
  const buyer = await buyerMember("u-buyer");
  const order = async (
    status: OrderStatus,
    dayOffset: number | null,
    patch: { cancelRequestedAt?: Date } = {},
  ) => {
    const id = await seedOrder({ lotId: lot.id, buyerUserId: buyer.userId, quantity: 2, status, paidAt: NOW });
    await prisma.order.update({
      where: { id },
      data: { ...patch, deliveryDate: dayOffset === null ? null : lagosDate(addDays(TODAY, dayOffset)) },
    });
    return id;
  };
  return { w, order };
}

describe("deliverySchedule", () => {
  it("schedule_leaves_out_cancel_requests_and_other_cooperatives", async () => {
    const { w, order } = await setup();
    const fine = await order("PAID_HELD", 1);
    await order("PREPARING", 2, { cancelRequestedAt: NOW });
    const other = await createTestCooperative({ name: "Other Coop", status: "VERIFIED" });
    const stranger = await officerMember("u-officer-2", other.id);
    const schedule = await deliverySchedule(w.officer, NOW);
    expect(schedule.days.flatMap((d) => d.orders.map((o) => o.id))).toEqual([fine]);
    expect(schedule.days[0].orders[0]).toMatchObject({
      title: "2 Bag · Maize",
      detail: "Buyer u-buyer",
      date: addDays(TODAY, 1),
      href: `/officer/orders/${fine}`,
    });
    expect(await deliverySchedule(stranger, NOW)).toEqual({ overdue: [], days: [], more: 0, noDate: 0, later: 0 });
    await expect(deliverySchedule(w.farmer, NOW)).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(deliverySchedule(w.admin, NOW)).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("schedule_puts_overdue_first_and_cuts_the_window_at_the_fourteenth_day", async () => {
    const { w, order } = await setup();
    const overdue = await order("PREPARING", -3);
    const todayOrder = await order("PAID_HELD", 0);
    const lastDay = await order("PAID_HELD", 13);
    const dayAfter = await order("PAID_HELD", 14);
    const schedule = await deliverySchedule(w.officer, NOW);
    expect(schedule.overdue.map((o) => o.id)).toEqual([overdue]);
    expect(schedule.days.map((d) => [d.date, d.orders.map((o) => o.id)])).toEqual([
      [TODAY, [todayOrder]],
      [addDays(TODAY, 13), [lastDay]],
    ]);
    expect(schedule.later).toBe(1);
    expect(dayAfter).toBeTruthy();
  });

  it("schedule_counts_undated_and_later_orders", async () => {
    const { w, order } = await setup();
    await order("PAID_HELD", null);
    await order("PREPARING", null);
    await order("PAID_HELD", 14);
    await order("PAID_HELD", 30);
    const schedule = await deliverySchedule(w.officer, NOW);
    expect(schedule).toMatchObject({ overdue: [], days: [], more: 0, noDate: 2, later: 2 });
  });

  it("schedule_reports_more_past_fifty_rows", async () => {
    const { w, order } = await setup();
    for (let i = 0; i < SCHEDULE_ROWS + 2; i += 1) await order("PAID_HELD", i % 14);
    const schedule = await deliverySchedule(w.officer, NOW);
    const shown = schedule.overdue.length + schedule.days.reduce((n, d) => n + d.orders.length, 0);
    expect(shown).toBe(50);
    expect(schedule.more).toBe(2);
  });

  it("schedule_treats_lagos_today_as_today_after_utc_midnight", async () => {
    const { w, order } = await setup();
    // 23:30 UTC on NOW's day is 00:30 the next day in Lagos.
    const late = new Date(`${TODAY}T23:30:00Z`);
    const lagosToday = addDays(TODAY, 1);
    const id = await order("PAID_HELD", 1);
    const schedule = await deliverySchedule(w.officer, late);
    expect(schedule.overdue).toEqual([]);
    expect(schedule.days.map((d) => [d.date, d.orders.map((o) => o.id)])).toEqual([[lagosToday, [id]]]);
  });

  it("every_open_order_lands_where_the_table_says", async () => {
    const { w, order } = await setup();
    const heldDated = await order("PAID_HELD", 2);
    const preparingDated = await order("PREPARING", 3);
    await order("PREPARING", null); // undated: only the schedule's closing line counts it
    const heldCancel = await order("PAID_HELD", 4, { cancelRequestedAt: NOW });
    const preparingCancel = await order("PREPARING", 5, { cancelRequestedAt: NOW });
    const disputed = await order("DISPUTED", 6);
    const timedOut = await order("TIMED_OUT", 7);
    const delivered = await order("DELIVERED_MARKED", 8);

    const schedule = await deliverySchedule(w.officer, NOW);
    const inSchedule = schedule.days.flatMap((d) => d.orders.map((o) => o.id)).concat(schedule.overdue.map((o) => o.id));
    const prepare = (await ordersToPrepareSummary(w.officer)).items.map((i) => i.id);
    const attentionSummary = await officerAttentionSummary(w.officer);
    const attention = attentionSummary.items.map((i) => i.id);
    expect(attentionSummary.count).toBe(4); // heldCancel, preparingCancel, disputed, timedOut; the tile lists three

    expect(inSchedule.sort()).toEqual([heldDated, preparingDated].sort());
    expect(schedule.noDate).toBe(1); // preparingUndated: a closing line only
    expect(prepare.sort()).toEqual([heldDated].sort());
    expect([heldCancel, preparingCancel, disputed, timedOut]).toEqual(expect.arrayContaining(attention));
    for (const id of [heldDated, preparingDated]) {
      expect([...inSchedule, ...prepare, ...attention]).toContain(id);
    }
    expect([...inSchedule, ...prepare, ...attention]).not.toContain(delivered);
  });
});
