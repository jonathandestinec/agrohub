import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { buyerOffersToActSummary, makeOffer, respondToOffer } from "@/modules/marketplace/service";
import { buyerOpenOrdersSummary, deliveriesToConfirmSummary, recentReceiptsSummary } from "@/modules/orders/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";
import { seedOrder } from "./order-fixtures";

const HOUR = 3_600_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const forbidden = { name: "ForbiddenError" };

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
  const other = await buyerMember("u-other");
  return { w, lotId: lot.id, buyer, other };
}

describe("buyerOffersToActSummary", () => {
  it("shows_accepted_with_pay_by_and_countered_with_a_label_oldest_first_across_lots", async () => {
    const { w, buyer, other } = await setup();
    const lots: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const lot = await submitLot(w.farmer, w.input({ quantity: 100 }), [PHOTO], NOW);
      await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
      lots.push(lot.id);
    }
    const made: string[] = [];
    for (const [i, lotId] of lots.entries()) {
      const o = await makeOffer(buyer, { lotId, quantity: 2, offeredKobo: 6_100_000 }, at(i * HOUR));
      await respondToOffer(
        w.officer,
        o.id,
        i === 1 ? { decision: "COUNTER", counterKobo: 6_400_000 } : { decision: "ACCEPT" },
        at(i * HOUR),
      );
      made.push(o.id);
    }
    await makeOffer(other, { lotId: lots[0], quantity: 1, offeredKobo: 6_100_000 }, NOW);

    const summary = await buyerOffersToActSummary(buyer, at(4 * HOUR));
    expect(summary.count).toBe(4);
    expect(summary.items.map((i) => i.id)).toEqual(made.slice(0, 3));
    expect(summary.items.map((i) => i.label)).toEqual([
      "offers.buyerStatus.ACCEPTED",
      "offers.buyerStatus.COUNTERED",
      "offers.buyerStatus.ACCEPTED",
    ]);
    expect(summary.items[0].date).toBeDefined();
    expect(summary.items[1].date).toBeUndefined();

    // Past the time to pay or to answer, the offers read expired and drop out.
    expect((await buyerOffersToActSummary(buyer, at(72 * HOUR))).count).toBe(0);
    expect((await buyerOffersToActSummary(other, at(HOUR))).count).toBe(0);
  });

  it("refuses_roles_other_than_a_buyer", async () => {
    const { w } = await setup();
    await expect(buyerOffersToActSummary(w.officer)).rejects.toMatchObject(forbidden);
    await expect(buyerOffersToActSummary(w.farmer)).rejects.toMatchObject(forbidden);
    await expect(buyerOffersToActSummary(w.admin)).rejects.toMatchObject(forbidden);
  });
});

describe("buyer order summaries", () => {
  async function orders() {
    const { w, lotId, buyer, other } = await setup();
    const make = async (actor: Actor, status: OrderStatus, patch: Record<string, unknown> = {}) => {
      const id = await seedOrder({ lotId, buyerUserId: actor.userId, quantity: 3, status });
      if (Object.keys(patch).length > 0) await prisma.order.update({ where: { id }, data: patch });
      return id;
    };
    return { w, buyer, other, make };
  }

  it("deliveriesToConfirm_counts_marked_delivered_oldest_marked_first", async () => {
    const { buyer, other, make } = await orders();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) ids.push(await make(buyer, "DELIVERED_MARKED", { deliveredMarkedAt: at(i * HOUR) }));
    await make(buyer, "PREPARING");
    await make(other, "DELIVERED_MARKED", { deliveredMarkedAt: NOW });
    const summary = await deliveriesToConfirmSummary(buyer);
    expect(summary.count).toBe(4);
    expect(summary.items.map((i) => i.id)).toEqual(ids.slice(0, 3));
    expect(summary.items[0]).toMatchObject({ title: "3 Bag · Maize", href: `/buyer/orders/${ids[0]}` });
  });

  it("openOrders_lists_orders_in_progress_with_their_buyer_status_and_delivery_date", async () => {
    const { buyer, other, make } = await orders();
    const dated = await make(buyer, "PAID_HELD", { deliveryDate: new Date("2026-11-20T00:00:00Z") });
    await make(buyer, "PREPARING");
    await make(buyer, "DISPUTED");
    await make(buyer, "TIMED_OUT");
    await make(buyer, "COMPLETED");
    await make(buyer, "CANCELLED");
    await make(buyer, "DELIVERED_MARKED");
    await make(other, "PAID_HELD");
    const summary = await buyerOpenOrdersSummary(buyer, NOW);
    expect(summary.count).toBe(4);
    expect(summary.items[0]).toMatchObject({ id: dated, label: "orders.status.PAID_HELD", date: "2026-11-20" });
    expect(summary.items.map((i) => i.label)).toEqual([
      "orders.status.PAID_HELD",
      "orders.status.PREPARING",
      "orders.status.UNDER_REVIEW",
    ]);
  });

  it("openOrders_shows_an_unpaid_checkout_past_its_window_as_expired", async () => {
    const { w, lotId, buyer } = await setup();
    await seedOrder({
      lotId,
      buyerUserId: buyer.userId,
      quantity: 3,
      status: "PENDING_PAYMENT",
      reservation: { expiresAt: at(-HOUR), countsTowardStock: false },
    });
    expect(w.cooperativeId).toBeTruthy();
    const summary = await buyerOpenOrdersSummary(buyer, NOW);
    expect(summary.count).toBe(1);
    expect(summary.items[0].label).toBe("orders.status.PAYMENT_EXPIRED");
  });

  it("recentReceipts_shows_the_newest_three_completed_orders_with_the_buyers_own_total", async () => {
    const { buyer, other, make } = await orders();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) ids.push(await make(buyer, "COMPLETED", { completedAt: at(i * HOUR) }));
    await make(other, "COMPLETED", { completedAt: at(10 * HOUR) });
    await make(buyer, "PAID_HELD");
    const summary = await recentReceiptsSummary(buyer);
    expect(summary.items.map((i) => i.id)).toEqual([ids[3], ids[2], ids[1]]);
    expect(summary.items[0]).toMatchObject({ href: `/buyer/orders/${ids[3]}/receipt`, detail: "₦195,000.00" });
  });

  it("refuses_roles_other_than_a_buyer", async () => {
    const { w } = await orders();
    for (const who of [w.officer, w.farmer, w.admin]) {
      await expect(deliveriesToConfirmSummary(who)).rejects.toMatchObject(forbidden);
      await expect(buyerOpenOrdersSummary(who)).rejects.toMatchObject(forbidden);
      await expect(recentReceiptsSummary(who)).rejects.toMatchObject(forbidden);
    }
  });
});
