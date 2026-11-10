import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "@/app/api/cron/[job]/route";
import { env } from "@/lib/env";
import { getJob } from "@/lib/jobs/registry";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { expireUnpaidOrders } from "@/modules/orders/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";
import { seedOrder } from "./order-fixtures";

const HOUR = 3_600_000;
let w: LotWorld;
let buyer: Actor;
let lotId: string;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
  buyer = await buyerMember("u-buyer");
  const lot = await submitLot(w.farmer, w.input({ quantity: 30 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
  lotId = lot.id;
});

afterAll(cleanDatabase);

async function unpaidAt(createdAt: Date): Promise<string> {
  const id = await seedOrder({ lotId, buyerUserId: buyer.userId, quantity: 5, status: "PENDING_PAYMENT", reservation: { expiresAt: new Date(createdAt.getTime() + 15 * 60_000) } });
  await prisma.order.update({ where: { id }, data: { createdAt } });
  return id;
}

describe("expireUnpaidOrders", () => {
  it("cancels unpaid orders older than 24 hours, once", async () => {
    const since = new Date();
    const old = await unpaidAt(new Date(NOW.getTime() - 25 * HOUR));
    const recent = await unpaidAt(new Date(NOW.getTime() - 23 * HOUR));
    const paid = await seedOrder({ lotId, buyerUserId: buyer.userId, quantity: 5, status: "PAID_HELD" });
    expect(await expireUnpaidOrders(NOW)).toBe(1);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: old } })).toMatchObject({ status: "CANCELLED", cancelReason: "PAYMENT_EXPIRED" });
    expect(await prisma.stockReservation.count({ where: { orderId: old } })).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: recent } })).status).toBe("PENDING_PAYMENT");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: paid } })).status).toBe("PAID_HELD");
    expect(await prisma.auditLog.count({ where: { action: "order.expire", entityId: old, createdAt: { gte: since } } })).toBe(1);
    expect(await expireUnpaidOrders(NOW)).toBe(0);
  });

  it("is registered as the order-expiry cron job", async () => {
    await import("@/lib/jobs");
    expect(getJob("order-expiry")).toBeTypeOf("function");
    const response = await GET(
      new Request("http://localhost:3000/api/cron/order-expiry", {
        headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      }),
      { params: Promise.resolve({ job: "order-expiry" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: expect.stringMatching(/^(ran|skipped)$/) });
  });
});
