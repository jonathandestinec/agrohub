import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { completeOrder, markDelivered } from "@/modules/orders/service";
import { cleanDatabase } from "./helpers";
import { paidOrder, paidWorld, type PaidWorld } from "./paid-order";

let w: PaidWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  w = await paidWorld();
});

afterEach(() => {
  vi.doUnmock("@/lib/env");
  vi.resetModules();
});

afterAll(cleanDatabase);

const post = (orderId: string) => new Request(`http://localhost:3100/api/dev/paystack/run-payouts?orderId=${orderId}`, { method: "POST" });

describe("POST /api/dev/paystack/run-payouts", () => {
  it("runs an order's payouts as the next day's job would", async () => {
    const { orderId } = await paidOrder(w, 30);
    await markDelivered(w.officer, orderId, 30);
    await completeOrder(orderId, "BUYER", new Date());
    const { POST } = await import("@/app/api/dev/paystack/run-payouts/route");
    const response = await POST(post(orderId));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 2, deferred: 0 });
    expect((await prisma.payout.findMany({ where: { orderId } })).map((p) => p.status)).toEqual(["PAID", "PAID"]);
  });

  it("is 404 for an unknown order or outside local development", async () => {
    const { POST } = await import("@/app/api/dev/paystack/run-payouts/route");
    expect((await POST(post("nothere"))).status).toBe(404);
    vi.resetModules();
    vi.doMock("@/lib/env", async (original) => ({ env: { ...(await original<typeof import("@/lib/env")>()).env, APP_ENV: "staging" } }));
    const { POST: stagingPost } = await import("@/app/api/dev/paystack/run-payouts/route");
    const { orderId } = await paidOrder(w, 5);
    expect((await stagingPost(post(orderId))).status).toBe(404);
  });
});
