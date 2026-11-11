import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import {
  approveLot,
  catalogRequestsSummary,
  listCooperativeCatalogRequests,
  listScreeningQueue,
  requestCatalogItem,
  screeningSummary,
  submitLot,
} from "@/modules/catalog/service";
import { listPendingFarmers, pendingFarmersSummary } from "@/modules/farmers/service";
import type { Actor } from "@/modules/identity/policies";
import { makeOffer, officerOffersSummary } from "@/modules/marketplace/service";
import { officerAttentionSummary, ordersToPrepareSummary } from "@/modules/orders/service";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";
import { buyerMember, farmerMember, lotWorld, NOW, officerMember, PHOTO, type LotWorld } from "./lot-fixtures";
import { seedOrder } from "./order-fixtures";

const HOUR = 3_600_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
});

afterAll(cleanDatabase);

async function pendingFarmer(userId: string, cooperativeId: string, createdAt: Date, withProfile = true) {
  await createTestUser({ id: userId, name: `Farmer ${userId}` });
  await prisma.membership.create({ data: { userId, role: "FARMER", cooperativeId, status: "PENDING", createdAt } });
  if (withProfile) {
    await prisma.farmerProfile.create({
      data: { userId, cooperativeId, farmSizeHectares: "1", state: "Kaduna", lga: "Zaria" },
    });
  }
}

async function liveLot(w: LotWorld, farmer: Actor, when = NOW) {
  const lot = await submitLot(farmer, w.input(), [PHOTO], when);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, when);
  return lot.id;
}

const forbidden = { name: "ForbiddenError" };

describe("pendingFarmersSummary", () => {
  it("counts_only_this_cooperatives_pending_farmers_oldest_first", async () => {
    const w = await lotWorld();
    const other = await createTestCooperative({ name: "Other Coop", status: "VERIFIED" });
    for (let i = 0; i < 4; i += 1) await pendingFarmer(`u-p${i}`, w.cooperativeId, at(i * HOUR));
    await pendingFarmer("u-elsewhere", other.id, at(0));
    await pendingFarmer("u-noprofile", w.cooperativeId, at(0), false);
    const summary = await pendingFarmersSummary(w.officer);
    expect(summary.count).toBe(4);
    expect(summary.items.map((i) => i.title)).toEqual(["Farmer u-p0", "Farmer u-p1", "Farmer u-p2"]);
    expect(summary.items[0]).toMatchObject({ href: "/officer/farmers" });
  });

  it("matches_listPendingFarmers_count", async () => {
    const w = await lotWorld();
    await pendingFarmer("u-p0", w.cooperativeId, NOW);
    await pendingFarmer("u-p1", w.cooperativeId, at(HOUR));
    await pendingFarmer("u-noprofile", w.cooperativeId, NOW, false);
    expect((await pendingFarmersSummary(w.officer)).count).toBe(
      (await listPendingFarmers(w.officer, w.cooperativeId)).length,
    );
  });

  it("refuses_other_roles_and_gives_another_cooperatives_officer_only_their_rows", async () => {
    const w = await lotWorld();
    await pendingFarmer("u-p0", w.cooperativeId, NOW);
    const otherCoop = await createTestCooperative({ name: "Other Coop", status: "VERIFIED" });
    const otherOfficer = await officerMember("u-officer-2", otherCoop.id);
    expect((await pendingFarmersSummary(otherOfficer)).count).toBe(0);
    await expect(pendingFarmersSummary(w.farmer)).rejects.toMatchObject(forbidden);
    await expect(pendingFarmersSummary(w.admin)).rejects.toMatchObject(forbidden);
    await expect(pendingFarmersSummary(await buyerMember("u-buyer"))).rejects.toMatchObject(forbidden);
  });
});

describe("screeningSummary", () => {
  it("counts_pending_countered_and_revision_lots_for_an_officer_oldest_first_and_matches_the_list", async () => {
    const w = await lotWorld();
    const f2 = await farmerMember("u-farmer-2", w.cooperativeId);
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) ids.push((await submitLot(i % 2 ? f2 : w.farmer, w.input(), [PHOTO], at(i * HOUR))).id);
    await prisma.lot.update({ where: { id: ids[1] }, data: { status: "COUNTERED" } });
    await liveLot(w, w.farmer); // LIVE without a revision: not in the queue
    const otherCoop = await createTestCooperative({ name: "Other Coop", status: "VERIFIED" });
    const stranger = await farmerMember("u-stranger", otherCoop.id);
    await submitLot(stranger, w.input(), [PHOTO], NOW);

    const summary = await screeningSummary(w.officer);
    expect(summary.count).toBe(4);
    expect(summary.items.map((i) => i.id)).toEqual(ids.slice(0, 3));
    expect(summary.items[0]).toMatchObject({ title: "30 Bag · Maize", href: `/officer/lots/${ids[0]}` });
    expect(summary.count).toBe((await listScreeningQueue(w.officer)).length);
    expect(JSON.stringify(summary)).not.toMatch(/floor|askKobo/i);
  });

  it("gives_an_admin_only_lots_no_other_officer_can_screen_and_matches_the_list", async () => {
    const w = await lotWorld(); // one officer who is not the farmer: lots are theirs to screen
    const soloCoop = await createTestCooperative({ name: "Solo Coop", status: "VERIFIED" });
    const soloFarmer = await farmerMember("u-solo-farmer", soloCoop.id);
    const lot = await submitLot(soloFarmer, w.input(), [PHOTO], NOW);
    await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    const summary = await screeningSummary(w.admin);
    expect(summary.count).toBe(1);
    expect(summary.items[0]).toMatchObject({ id: lot.id, href: `/admin/lots/${lot.id}` });
    expect(summary.count).toBe((await listScreeningQueue(w.admin)).length);
  });

  it("refuses_farmers_and_buyers_and_other_cooperatives_officers_see_only_their_own", async () => {
    const w = await lotWorld();
    await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    await expect(screeningSummary(w.farmer)).rejects.toMatchObject(forbidden);
    await expect(screeningSummary(await buyerMember("u-buyer"))).rejects.toMatchObject(forbidden);
    const otherCoop = await createTestCooperative({ name: "Other Coop", status: "VERIFIED" });
    expect((await screeningSummary(await officerMember("u-officer-2", otherCoop.id))).count).toBe(0);
  });
});

describe("catalogRequestsSummary", () => {
  it("counts_requests_with_the_officer_in_this_cooperative_and_matches_the_list", async () => {
    const w = await lotWorld();
    for (let i = 0; i < 4; i += 1) {
      await requestCatalogItem(w.farmer, { kind: "CROP", name: `Sorghum ${i}` });
    }
    const otherCoop = await createTestCooperative({ name: "Other Coop", status: "VERIFIED" });
    await requestCatalogItem(await farmerMember("u-stranger", otherCoop.id), { kind: "CROP", name: "Millet" });
    const summary = await catalogRequestsSummary(w.officer);
    expect(summary.count).toBe(4);
    expect(summary.items).toHaveLength(3);
    expect(summary.items.map((i) => i.title)).toEqual(["Sorghum 0", "Sorghum 1", "Sorghum 2"]);
    expect(summary.count).toBe((await listCooperativeCatalogRequests(w.officer)).length);
    await expect(catalogRequestsSummary(w.farmer)).rejects.toMatchObject(forbidden);
  });
});

describe("officerOffersSummary", () => {
  it("counts_open_unexpired_offers_of_this_cooperative_oldest_first", async () => {
    const w = await lotWorld();
    const lotId = await liveLot(w, w.farmer);
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const buyer = await buyerMember(`u-buyer-${i}`);
      ids.push((await makeOffer(buyer, { lotId, quantity: 5, offeredKobo: 6_000_000 }, at(i * HOUR))).id);
    }
    const summary = await officerOffersSummary(w.officer, at(5 * HOUR));
    expect(summary.count).toBe(4);
    expect(summary.items.map((i) => i.id)).toEqual(ids.slice(0, 3));
    expect(summary.items[0]).toMatchObject({ title: "5 Bag · Maize", href: `/officer/offers/${ids[0]}` });
    expect((await officerOffersSummary(w.officer, at(24 * 30 * HOUR))).count).toBe(0);
    const otherCoop = await createTestCooperative({ name: "Other Coop", status: "VERIFIED" });
    expect((await officerOffersSummary(await officerMember("u-officer-2", otherCoop.id), at(5 * HOUR))).count).toBe(0);
    await expect(officerOffersSummary(w.farmer)).rejects.toMatchObject(forbidden);
    await expect(officerOffersSummary(w.admin)).rejects.toMatchObject(forbidden);
  });
});

describe("order summaries", () => {
  async function orders(w: LotWorld) {
    const lotId = await liveLot(w, w.farmer);
    const buyer = await buyerMember("u-buyer");
    const make = (status: OrderStatus, paidAt: Date, patch: { cancelRequestedAt?: Date } = {}) =>
      seedOrder({ lotId, buyerUserId: buyer.userId, quantity: 2, status, paidAt }).then(async (id) => {
        if (patch.cancelRequestedAt) await prisma.order.update({ where: { id }, data: patch });
        return id;
      });
    return { lotId, buyer, make };
  }

  it("ordersToPrepare_counts_paid_held_without_cancel_request_oldest_paid_first", async () => {
    const w = await lotWorld();
    const { make } = await orders(w);
    const held: string[] = [];
    for (let i = 0; i < 4; i += 1) held.push(await make("PAID_HELD", at(i * HOUR)));
    await make("PAID_HELD", at(0), { cancelRequestedAt: NOW });
    await make("PREPARING", at(0));
    await make("COMPLETED", at(0));
    const summary = await ordersToPrepareSummary(w.officer);
    expect(summary.count).toBe(4);
    expect(summary.items.map((i) => i.id)).toEqual(held.slice(0, 3));
    expect(summary.items[0]).toMatchObject({ title: "2 Bag · Maize", detail: "Buyer u-buyer", href: `/officer/orders/${held[0]}` });
    expect(JSON.stringify(summary)).not.toMatch(/Kobo|₦|@example|\+234/);
  });

  it("needs_attention_counts_disputes_timeouts_and_cancel_requests_with_a_label", async () => {
    const w = await lotWorld();
    const { make } = await orders(w);
    const disputed = await make("DISPUTED", at(0));
    await make("TIMED_OUT", at(HOUR));
    const cancel = await make("PREPARING", at(2 * HOUR), { cancelRequestedAt: NOW });
    await make("PAID_HELD", at(3 * HOUR), { cancelRequestedAt: NOW });
    await make("PAID_HELD", at(4 * HOUR));
    await make("DELIVERED_MARKED", at(4 * HOUR));
    const summary = await officerAttentionSummary(w.officer);
    expect(summary.count).toBe(4);
    expect(summary.items).toHaveLength(3);
    const byId = new Map(summary.items.map((i) => [i.id, i]));
    expect(byId.get(disputed)?.label).toBe("orders.officerStatus.DISPUTED");
    expect(byId.get(cancel)?.label).toBe("home.labels.CANCEL_REQUESTED");
  });

  it("leaves_out_other_cooperatives_orders_and_refuses_other_roles", async () => {
    const w = await lotWorld();
    const { make } = await orders(w);
    await make("PAID_HELD", NOW);
    const otherCoop = await createTestCooperative({ name: "Other Coop", status: "VERIFIED" });
    const stranger = await officerMember("u-officer-2", otherCoop.id);
    expect((await ordersToPrepareSummary(stranger)).count).toBe(0);
    expect((await officerAttentionSummary(stranger)).count).toBe(0);
    for (const who of [w.farmer, w.admin, w.board]) {
      await expect(ordersToPrepareSummary(who)).rejects.toMatchObject(forbidden);
      await expect(officerAttentionSummary(who)).rejects.toMatchObject(forbidden);
    }
  });
});
