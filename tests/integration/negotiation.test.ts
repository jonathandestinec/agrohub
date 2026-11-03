import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot, withdrawLot } from "@/modules/catalog/service";
import { suspendCooperative } from "@/modules/cooperatives/service";
import type { Actor } from "@/modules/identity/policies";
import {
  farmerRespondToOffer,
  getCooperativeOffer,
  getOwnOffer,
  listCooperativeOffers,
  listOffersAwaitingFarmer,
  makeOffer,
  respondToCounter,
  respondToOffer,
  withdrawOffer,
} from "@/modules/marketplace/service";
import { cleanDatabase, createTestCooperative } from "./helpers";
import { buyerMember, lotWorld, NOW, officerMember, PHOTO, type LotWorld } from "./lot-fixtures";

const ASK = 6_500_000;
const FLOOR = 5_500_000;
const HOUR = 3_600_000;
let w: LotWorld;
let buyer: Actor;
let lotId: string;

const at = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
  buyer = await buyerMember("u-buyer");
  const lot = await submitLot(w.farmer, w.input({ askKobo: ASK, floorKobo: FLOOR, quantity: 30 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
  lotId = lot.id;
});

afterAll(cleanDatabase);

async function offer(who: Actor, offeredKobo: number, quantity = 10, when = NOW) {
  return makeOffer(who, { lotId, quantity, offeredKobo }, when);
}

describe("respondToOffer", () => {
  it("lets the officer accept alone at or above the floor", async () => {
    const o = await offer(buyer, 6_000_000);
    const since = new Date();
    const decided = await respondToOffer(w.officer, o.id, { decision: "ACCEPT" }, at(HOUR));
    expect(decided).toMatchObject({ status: "ACCEPTED", agreedKobo: 6_000_000, belowFloor: false });
    const seen = await getOwnOffer(buyer, o.id, at(HOUR));
    expect(seen).toMatchObject({
      status: "ACCEPTED",
      agreedKobo: 6_000_000,
      totalKobo: 60_000_000,
      payByAt: at(25 * HOUR).toISOString(),
    });
    const audits = await prisma.auditLog.findMany({ where: { action: "offer.accept", createdAt: { gte: since } } });
    expect(audits.map((a) => a.meta)).toEqual([{ offerId: o.id, agreedKobo: 6_000_000, quantity: 10 }]);
  });

  it("buyer_cannot_tell_offer_is_below_floor", async () => {
    const o = await offer(buyer, 5_000_000);
    const before = await getOwnOffer(buyer, o.id, at(HOUR));
    const referred = await respondToOffer(w.officer, o.id, { decision: "ACCEPT" }, at(HOUR));
    expect(referred).toMatchObject({ status: "AWAITING_FARMER", belowFloor: true });
    expect(await getOwnOffer(buyer, o.id, at(HOUR))).toEqual(before);
    expect((await listCooperativeOffers(w.officer, at(HOUR))).find((x) => x.id === o.id)?.status).toBe(
      "AWAITING_FARMER",
    );

    await farmerRespondToOffer(w.farmer, o.id, true, at(2 * HOUR));
    expect(await getOwnOffer(buyer, o.id, at(2 * HOUR))).toMatchObject({ status: "ACCEPTED", agreedKobo: 5_000_000 });
  });

  it("reads a farmer's decline and an officer's rejection the same way to the buyer", async () => {
    const other = await buyerMember("u-buyer-2");
    const declinedByFarmer = await offer(buyer, 5_000_000);
    await respondToOffer(w.officer, declinedByFarmer.id, { decision: "ACCEPT" }, at(HOUR));
    await farmerRespondToOffer(w.farmer, declinedByFarmer.id, false, at(HOUR));
    const rejectedByOfficer = await offer(other, 6_000_000);
    await respondToOffer(w.officer, rejectedByOfficer.id, { decision: "REJECT" }, at(HOUR));
    expect((await getOwnOffer(buyer, declinedByFarmer.id, at(HOUR))).status).toBe("DECLINED");
    expect((await getOwnOffer(other, rejectedByOfficer.id, at(HOUR))).status).toBe("DECLINED");
  });

  it("shows the farmer the offer with their take-home and no buyer identity", async () => {
    const o = await offer(buyer, 5_000_000);
    await respondToOffer(w.officer, o.id, { decision: "ACCEPT" }, at(HOUR));
    const waiting = await listOffersAwaitingFarmer(w.farmer, at(HOUR));
    expect(waiting).toHaveLength(1);
    // Locked terms: 4% cooperative cut, 3% AgroHub fee on ₦50,000 × 10.
    expect(waiting[0]).toMatchObject({
      id: o.id,
      lotId,
      quantity: 10,
      offeredKobo: 5_000_000,
      breakdown: { grossKobo: 50_000_000, cooperativeKobo: 2_000_000, feeKobo: 1_500_000, takeHomeKobo: 46_500_000 },
    });
    const json = JSON.stringify(waiting);
    expect(json).not.toContain(buyer.userId);
    expect(json).not.toContain("Buyer u-buyer");
  });

  it("counters within the rules and lets the buyer accept the counter", async () => {
    const o = await offer(buyer, 5_000_000);
    const tooLow = respondToOffer(w.officer, o.id, { decision: "COUNTER", counterKobo: 5_400_000 }, at(HOUR));
    await expect(tooLow).rejects.toMatchObject({ code: "COUNTER_BELOW_FLOOR" });
    const tooHigh = respondToOffer(w.officer, o.id, { decision: "COUNTER", counterKobo: 7_000_000 }, at(HOUR));
    await expect(tooHigh).rejects.toMatchObject({ code: "COUNTER_ABOVE_ASK" });
    const notAbove = respondToOffer(w.officer, o.id, { decision: "COUNTER", counterKobo: 5_000_000 }, at(HOUR));
    await expect(notAbove).rejects.toMatchObject({ code: "COUNTER_NOT_ABOVE_OFFER" });
    const missing = respondToOffer(w.officer, o.id, { decision: "COUNTER" }, at(HOUR));
    await expect(missing).rejects.toMatchObject({ code: "INVALID_OFFER" });

    await respondToOffer(w.officer, o.id, { decision: "COUNTER", counterKobo: 6_200_000 }, at(HOUR));
    expect(await getOwnOffer(buyer, o.id, at(HOUR))).toMatchObject({
      status: "COUNTERED",
      counterKobo: 6_200_000,
      expiresAt: at(49 * HOUR).toISOString(),
    });
    const accepted = await respondToCounter(buyer, o.id, true, at(2 * HOUR));
    expect(accepted).toMatchObject({ status: "ACCEPTED", agreedKobo: 6_200_000, totalKobo: 62_000_000 });
  });

  it("withdraws the offer when the buyer declines a counter", async () => {
    const o = await offer(buyer, 5_000_000);
    await respondToOffer(w.officer, o.id, { decision: "COUNTER", counterKobo: 6_200_000 }, at(HOUR));
    expect((await respondToCounter(buyer, o.id, false, at(HOUR))).status).toBe("WITHDRAWN");
  });

  it("concurrent_accepts_never_oversell", async () => {
    const a = await offer(buyer, 6_000_000, 12);
    const b = await offer(await buyerMember("u-buyer-2"), 6_000_000, 12);
    const third = await buyerMember("u-buyer-3");
    const c = await offer(third, 5_000_000, 12);
    await respondToOffer(w.officer, c.id, { decision: "COUNTER", counterKobo: 6_000_000 }, NOW);
    const second = await officerMember("u-officer-2", w.cooperativeId);
    const results = await Promise.allSettled([
      respondToOffer(w.officer, a.id, { decision: "ACCEPT" }, NOW),
      respondToOffer(second, b.id, { decision: "ACCEPT" }, NOW),
      respondToCounter(third, c.id, true, NOW),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toMatchObject({ code: "NOT_ENOUGH_STOCK" });
    expect(await prisma.offer.count({ where: { lotId, status: "ACCEPTED" } })).toBe(2);
  });

  it("offer_on_unavailable_lot_cannot_be_accepted", async () => {
    const o = await offer(buyer, 6_000_000);
    await withdrawLot(w.farmer, lotId);
    await expect(respondToOffer(w.officer, o.id, { decision: "ACCEPT" }, NOW)).rejects.toMatchObject({
      code: "LOT_NOT_AVAILABLE",
    });
    expect((await getOwnOffer(buyer, o.id, NOW)).status).toBe("EXPIRED");
  });

  it("refuses acceptance once the cooperative is suspended", async () => {
    const o = await offer(buyer, 5_000_000);
    await respondToOffer(w.officer, o.id, { decision: "ACCEPT" }, NOW);
    await suspendCooperative(w.admin, w.cooperativeId, "Certificate under review");
    await expect(farmerRespondToOffer(w.farmer, o.id, true, NOW)).rejects.toMatchObject({
      code: "LOT_NOT_AVAILABLE",
    });
    expect((await getOwnOffer(buyer, o.id, NOW)).status).toBe("EXPIRED");
  });

  it("hides another cooperative's offer and refuses a second answer", async () => {
    const o = await offer(buyer, 6_000_000);
    const elsewhere = await officerMember("u-officer-x", (await createTestCooperative({ status: "VERIFIED" })).id);
    await expect(respondToOffer(elsewhere, o.id, { decision: "REJECT" }, NOW)).rejects.toMatchObject({
      code: "OFFER_NOT_FOUND",
    });
    await expect(getCooperativeOffer(elsewhere, o.id, NOW)).rejects.toMatchObject({ code: "OFFER_NOT_FOUND" });
    await respondToOffer(w.officer, o.id, { decision: "REJECT" }, NOW);
    await expect(respondToOffer(w.officer, o.id, { decision: "ACCEPT" }, NOW)).rejects.toMatchObject({
      code: "OFFER_NOT_OPEN",
    });
    await expect(farmerRespondToOffer(w.farmer, o.id, true, NOW)).rejects.toMatchObject({
      code: "OFFER_NOT_AWAITING_FARMER",
    });
  });

  it("lets the buyer withdraw a waiting offer, and only a live one", async () => {
    const o = await offer(buyer, 6_000_000);
    expect((await withdrawOffer(buyer, o.id, NOW)).status).toBe("WITHDRAWN");
    await expect(withdrawOffer(buyer, o.id, NOW)).rejects.toMatchObject({ code: "OFFER_NOT_LIVE" });
  });

  it("shows the officer the buyer's name, the floor and whether the offer is below it", async () => {
    const o = await offer(buyer, 5_000_000);
    const seen = await getCooperativeOffer(w.officer, o.id, NOW);
    expect(seen).toMatchObject({
      id: o.id,
      buyerName: "Buyer u-buyer",
      askKobo: ASK,
      floorKobo: FLOOR,
      belowFloor: true,
      status: "OPEN",
    });
    expect(JSON.stringify(seen)).not.toContain("@example.com");
  });

  it("offer_audit_never_contains_floor", async () => {
    const since = new Date();
    const referred = await offer(buyer, 5_000_000);
    await respondToOffer(w.officer, referred.id, { decision: "ACCEPT" }, NOW);
    await farmerRespondToOffer(w.farmer, referred.id, true, NOW);
    const other = await buyerMember("u-buyer-2");
    const countered = await offer(other, 5_000_000);
    await respondToOffer(w.officer, countered.id, { decision: "COUNTER", counterKobo: 6_000_000 }, NOW);
    await respondToCounter(other, countered.id, true, NOW);
    const rows = await prisma.auditLog.findMany({ where: { action: { startsWith: "offer." }, createdAt: { gte: since } } });
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) expect(JSON.stringify(row.meta)).not.toContain(String(FLOOR));
  });
});
