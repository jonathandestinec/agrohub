import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { GET } from "@/app/api/cron/[job]/route";
import { env } from "@/lib/env";
import { getJob } from "@/lib/jobs/registry";
import { markDelivered, runOrderTimers, startPreparing } from "@/modules/orders/service";
import { cleanDatabase } from "./helpers";
import { HOUR, paidOrder, paidWorld, type PaidWorld } from "./paid-order";

let w: PaidWorld;
const DAY = 24 * HOUR;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  w = await paidWorld();
});

afterAll(cleanDatabase);

const order = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, include: { payouts: true } });

describe("runOrderTimers", () => {
  it("releases 72 hours after the delivery mark, once", async () => {
    const T = new Date(Date.now() - 80 * HOUR);
    const { orderId } = await paidOrder(w, 30, new Date(T.getTime() - HOUR));
    await markDelivered(w.officer, orderId, 30, T);
    expect(await runOrderTimers(new Date(T.getTime() + 71 * HOUR))).toEqual({ released: 0, timedOut: 0 });
    expect((await order(orderId)).status).toBe("DELIVERED_MARKED");
    expect(await runOrderTimers(new Date(T.getTime() + 72 * HOUR))).toEqual({ released: 1, timedOut: 0 });
    const after = await order(orderId);
    expect(after.status).toBe("COMPLETED");
    expect(after.payouts).toHaveLength(2);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "order.completed", entityId: orderId } });
    expect(audit.meta).toMatchObject({ by: "AUTO" });
    expect(await runOrderTimers(new Date(T.getTime() + 73 * HOUR))).toEqual({ released: 0, timedOut: 0 });
  });

  it("times out an order paid 14 days ago with no delivery mark, with a TIMEOUT dispute", async () => {
    const P = new Date(Date.now() - 15 * DAY);
    const { orderId, paidAt } = await paidOrder(w, 10, P);
    const second = await paidOrder(w, 10, P);
    await startPreparing(w.officer, second.orderId, P);
    expect(await runOrderTimers(new Date(paidAt.getTime() + 13 * DAY))).toEqual({ released: 0, timedOut: 0 });
    const at = new Date(paidAt.getTime() + 14 * DAY + 60_000);
    expect(await runOrderTimers(at)).toEqual({ released: 0, timedOut: 2 });
    const after = await order(orderId);
    expect(after).toMatchObject({ status: "TIMED_OUT", timedOutAt: at });
    expect(await prisma.dispute.findFirstOrThrow({ where: { orderId } })).toMatchObject({ kind: "TIMEOUT", status: "OPEN" });
    expect(await runOrderTimers(new Date(at.getTime() + DAY))).toEqual({ released: 0, timedOut: 0 });
  });

  it("a timed-out order the cooperative then marks delivered goes on, and its timeout is closed", async () => {
    const P = new Date(Date.now() - 15 * DAY);
    const { orderId, paidAt } = await paidOrder(w, 10, P);
    await runOrderTimers(new Date(paidAt.getTime() + 14 * DAY + 60_000));
    await markDelivered(w.officer, orderId, 10);
    expect((await order(orderId)).status).toBe("DELIVERED_MARKED");
    expect(await prisma.dispute.findFirstOrThrow({ where: { orderId } })).toMatchObject({ kind: "TIMEOUT", status: "RESOLVED", outcome: "NOTE" });
  });

  it("is registered as the order-timers cron job", async () => {
    await import("@/lib/jobs");
    expect(getJob("order-timers")).toBeTypeOf("function");
    const response = await GET(
      new Request("http://localhost:3000/api/cron/order-timers", { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }),
      { params: Promise.resolve({ job: "order-timers" }) },
    );
    expect(response.status).toBe(200);
  });
});
