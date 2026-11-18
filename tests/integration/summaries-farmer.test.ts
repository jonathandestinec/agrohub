import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import { farmerCounteredLotsSummary, farmerLotCounts } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { farmerOffersSummary, listOffersAwaitingFarmer, makeOffer, respondToOffer } from "@/modules/marketplace/service";
import { latestThreads, listOwnThreads, openLotThread, postMessage } from "@/modules/messaging/service";
import { confirmReceipt, listOwnEarnings, markDelivered, recentEarningsSummary } from "@/modules/orders/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, farmerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";
import { paidOrder, paidWorld, type PaidWorld } from "./paid-order";

const HOUR = 3_600_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
});

afterAll(cleanDatabase);

async function liveLot(w: LotWorld, farmer: Actor, quantity = 30) {
  const lot = await submitLot(farmer, w.input({ quantity, askKobo: 6_500_000, floorKobo: 5_500_000 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
  return lot.id;
}

// An offer below the floor that the officer referred to the farmer.
async function referredOffer(officer: Actor, lotId: string, buyer: Actor, when: Date) {
  const offer = await makeOffer(buyer, { lotId, quantity: 5, offeredKobo: 5_000_000 }, when);
  await respondToOffer(officer, offer.id, { decision: "ACCEPT" }, when);
  return offer.id;
}

describe("farmerOffersSummary", () => {
  it("counts_only_offers_waiting_on_this_farmer_and_lists_the_oldest_three", async () => {
    const w = await lotWorld();
    const lotId = await liveLot(w, w.farmer);
    const other = await farmerMember("u-farmer-2", w.cooperativeId);
    const otherLot = await liveLot(w, other);
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      ids.push(await referredOffer(w.officer, lotId, await buyerMember(`u-buyer-${i}`), at(i * HOUR)));
    }
    // Not counted: still open (at or above the floor), on another farmer's lot.
    await makeOffer(await buyerMember("u-buyer-open"), { lotId, quantity: 5, offeredKobo: 6_000_000 }, at(HOUR));
    await referredOffer(w.officer, otherLot, await buyerMember("u-buyer-x"), at(HOUR));

    const summary = await farmerOffersSummary(w.farmer, at(5 * HOUR));
    expect(summary.count).toBe(4);
    expect(summary.items.map((i) => i.id)).toEqual(ids.slice(0, 3));
    expect(summary.items[0]).toMatchObject({ title: "5 Bag · Maize", href: `/farmer/lots/${lotId}` });
    expect(JSON.stringify(summary)).not.toMatch(/floor|5000000|5500000/i);
  });

  it("matches_listOffersAwaitingFarmer_count", async () => {
    const w = await lotWorld();
    const lotId = await liveLot(w, w.farmer);
    await referredOffer(w.officer, lotId, await buyerMember("u-buyer-a"), NOW);
    await referredOffer(w.officer, lotId, await buyerMember("u-buyer-b"), at(HOUR));
    const now = at(2 * HOUR);
    expect((await farmerOffersSummary(w.farmer, now)).count).toBe((await listOffersAwaitingFarmer(w.farmer, now)).length);
  });

  it("leaves_out_an_expired_offer", async () => {
    const w = await lotWorld();
    const lotId = await liveLot(w, w.farmer);
    await referredOffer(w.officer, lotId, await buyerMember("u-buyer-a"), NOW);
    expect((await farmerOffersSummary(w.farmer, at(24 * 30 * HOUR))).count).toBe(0);
  });

  it("refuses_roles_the_list_refuses", async () => {
    const w = await lotWorld();
    const buyer = await buyerMember("u-buyer");
    await expect(farmerOffersSummary(w.officer)).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(farmerOffersSummary(buyer)).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(farmerOffersSummary(w.admin)).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});

describe("farmerCounteredLotsSummary and farmerLotCounts", () => {
  it("counts_only_own_countered_lots_oldest_first", async () => {
    const w = await lotWorld();
    const other = await farmerMember("u-farmer-2", w.cooperativeId);
    const mine: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const lot = await submitLot(w.farmer, w.input({ quantity: 10 + i }), [PHOTO], at(i * HOUR));
      mine.push(lot.id);
    }
    await prisma.lot.updateMany({ where: { id: { in: mine } }, data: { status: "COUNTERED" } });
    const theirs = await submitLot(other, w.input(), [PHOTO], NOW);
    await prisma.lot.update({ where: { id: theirs.id }, data: { status: "COUNTERED" } });
    await liveLot(w, w.farmer);

    const summary = await farmerCounteredLotsSummary(w.farmer);
    expect(summary.count).toBe(4);
    expect(summary.items.map((i) => i.id)).toEqual(mine.slice(0, 3));
    expect(summary.items[0]).toMatchObject({ title: "10 Bag · Maize", href: `/farmer/lots/${mine[0]}` });
  });

  it("counts_lots_by_status_for_this_farmer_only", async () => {
    const w = await lotWorld();
    const other = await farmerMember("u-farmer-2", w.cooperativeId);
    await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    await liveLot(w, w.farmer);
    await liveLot(w, w.farmer);
    const sold = await liveLot(w, w.farmer);
    await prisma.lot.update({ where: { id: sold }, data: { status: "SOLD_OUT" } });
    const rejected = await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    await prisma.lot.update({ where: { id: rejected.id }, data: { status: "REJECTED" } });
    await liveLot(w, other);
    expect(await farmerLotCounts(w.farmer)).toEqual({ pendingReview: 1, live: 2, soldOut: 1 });
    expect(await farmerLotCounts(other)).toEqual({ pendingReview: 0, live: 1, soldOut: 0 });
  });

  it("refuses_roles_other_than_a_farmer", async () => {
    const w = await lotWorld();
    await expect(farmerCounteredLotsSummary(w.officer)).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(farmerLotCounts(w.admin)).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});

describe("recentEarningsSummary", () => {
  async function completed(w: PaidWorld, quantity: number, when: Date) {
    const { orderId } = await paidOrder(w, quantity, when);
    await markDelivered(w.officer, orderId, quantity, when);
    await confirmReceipt(w.buyer, orderId, when);
    return orderId;
  }

  it("shows_the_newest_three_with_the_farmers_own_amount_and_matches_the_statements", async () => {
    const w = await paidWorld({ quantity: 40 });
    const ids: string[] = [];
    for (let i = 1; i <= 4; i += 1) ids.push(await completed(w, i, new Date(Date.now() + i * HOUR)));
    const summary = await recentEarningsSummary(w.farmer);
    const statements = await listOwnEarnings(w.farmer);
    expect(summary.items.map((i) => i.id)).toEqual(statements.slice(0, 3).map((s) => s.orderId));
    expect(summary.items).toHaveLength(3);
    expect(summary.items[0]).toMatchObject({ href: `/farmer/earnings/${summary.items[0].id}` });
    expect(summary.items[0].detail).toMatch(/^₦/);
    expect(summary.items.map((i) => i.id)).not.toContain(ids[0]);
  });

  it("leaves_out_another_farmers_earnings_and_refuses_other_roles", async () => {
    const w = await paidWorld();
    await completed(w, 2, new Date());
    const other = await farmerMember("u-farmer-2", w.cooperativeId);
    expect((await recentEarningsSummary(other)).items).toHaveLength(0);
    await expect(recentEarningsSummary(w.officer)).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(recentEarningsSummary(w.buyer)).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});

describe("latestThreads", () => {
  it("shows_the_newest_three_threads_of_the_actor_only", async () => {
    const w = await lotWorld();
    const buyers = [] as Actor[];
    const threadIds: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const buyer = await buyerMember(`u-buyer-${i}`);
      buyers.push(buyer);
      const lotId = await liveLot(w, w.farmer);
      const { threadId } = await openLotThread(buyer, lotId, at(i * HOUR));
      await postMessage(buyer, threadId, "Hello there", at(i * HOUR));
      threadIds.push(threadId);
    }
    const summary = await latestThreads(buyers[0]);
    expect(summary.items.map((i) => i.id)).toEqual([threadIds[0]]);
    expect(summary.items[0]).toMatchObject({ href: `/messages/${threadIds[0]}`, title: "Zaria Growers" });

    const officerSummary = await latestThreads(w.officer);
    expect(officerSummary.items.map((i) => i.id)).toEqual([threadIds[3], threadIds[2], threadIds[1]]);
    expect(officerSummary.items).toHaveLength((await listOwnThreads(w.officer)).slice(0, 3).length);
    expect(JSON.stringify(officerSummary)).not.toContain("Hello there");
  });

  it("refuses_a_board_admin", async () => {
    const w = await lotWorld();
    await expect(latestThreads(w.board)).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});
