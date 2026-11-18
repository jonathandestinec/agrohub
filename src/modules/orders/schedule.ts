import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { addDays, lagosDate, lagosDateKey } from "@/lib/lagos-date";
import type { TileItem } from "@/lib/summary";
import { can, type Actor } from "@/modules/identity/policies";
import { toOrderTileItem } from "./views";

export type DeliveryRow = TileItem & { date: string }; // date = YYYY-MM-DD, a Lagos calendar day

export type DeliverySchedule = {
  overdue: DeliveryRow[];
  days: { date: string; orders: DeliveryRow[] }[]; // earliest first, only days that have orders
  more: number; // rows past the 50-row cap (overdue and days together)
  noDate: number;
  later: number;
};

export const SCHEDULE_DAYS = 14;
export const SCHEDULE_ROWS = 50;

// Pure: today in Lagos, and the last day of the 14-day window (today plus 13 days).
export function scheduleWindow(now: Date): { todayKey: string; lastKey: string } {
  const todayKey = lagosDateKey(now);
  return { todayKey, lastKey: addDays(todayKey, SCHEDULE_DAYS - 1) };
}

// Pure: splits rows dated up to the last day into the overdue ones (before today) and one group
// per later date, earliest first. It is given only rows dated up to `lastKey`.
export function groupSchedule(
  rows: DeliveryRow[],
  todayKey: string,
): Pick<DeliverySchedule, "overdue" | "days"> {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const overdue: DeliveryRow[] = [];
  const days: DeliverySchedule["days"] = [];
  for (const row of sorted) {
    if (row.date < todayKey) {
      overdue.push(row);
      continue;
    }
    const last = days[days.length - 1];
    if (last && last.date === row.date) last.orders.push(row);
    else days.push({ date: row.date, orders: [row] });
  }
  return { overdue, days };
}

// The cooperative's orders still to deliver (PAID_HELD or PREPARING, no cancel request) by
// delivery date: overdue, the next 14 days, and counts of those undated and those later.
export async function deliverySchedule(actor: Actor, now: Date = new Date()): Promise<DeliverySchedule> {
  if (!actor.cooperativeId || !can(actor, "order:manage", { cooperativeId: actor.cooperativeId })) {
    throw new ForbiddenError();
  }
  const { todayKey, lastKey } = scheduleWindow(now);
  const last = lagosDate(lastKey);
  const open = {
    cooperativeId: actor.cooperativeId,
    status: { in: ["PAID_HELD", "PREPARING"] as ("PAID_HELD" | "PREPARING")[] },
    cancelRequestedAt: null,
  };
  const [rows, withinWindow, noDate, later] = await Promise.all([
    prisma.order.findMany({
      where: { ...open, deliveryDate: { lte: last } },
      select: {
        id: true,
        quantity: true,
        deliveryDate: true,
        buyer: { select: { name: true } },
        lot: { select: { crop: { select: { name: true } }, unit: { select: { name: true } } } },
      },
      orderBy: [{ deliveryDate: "asc" }, { id: "asc" }],
      take: SCHEDULE_ROWS,
    }),
    prisma.order.count({ where: { ...open, deliveryDate: { lte: last } } }),
    prisma.order.count({ where: { ...open, deliveryDate: null } }),
    prisma.order.count({ where: { ...open, deliveryDate: { gt: last } } }),
  ]);
  const shown: DeliveryRow[] = rows.map((row) => {
    const date = (row.deliveryDate as Date).toISOString().slice(0, 10);
    return { ...toOrderTileItem(row, `/officer/orders/${row.id}`, { detail: row.buyer.name }), date };
  });
  return { ...groupSchedule(shown, todayKey), more: Math.max(0, withinWindow - shown.length), noDate, later };
}
