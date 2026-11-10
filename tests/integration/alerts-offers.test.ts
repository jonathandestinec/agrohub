import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import {
  expireOffers,
  farmerRespondToOffer,
  makeOffer,
  respondToCounter,
  respondToOffer,
  withdrawOffer,
} from "@/modules/marketplace/service";
import { alertKinds, alertsFor } from "./alert-helpers";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

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
  const lot = await submitLot(w.farmer, w.input({ askKobo: ASK, floorKobo: FLOOR }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
  lotId = lot.id;
  // Setting the lot up raised its own alerts; these tests look only at the offer's.
  await prisma.notification.deleteMany();
});

afterAll(cleanDatabase);

async function offer(offeredKobo = ASK, message?: string): Promise<string> {
  return (await makeOffer(buyer, { lotId, quantity: 10, offeredKobo, message }, NOW)).id;
}
const clearAlerts = () => prisma.notification.deleteMany();
const QTY = { crop: "Maize", quantity: 10, unit: "Bag" };

describe("offer alerts", () => {
  it("tells_officers_an_offer_arrived", async () => {
    const id = await offer();
    expect(await alertKinds(w.officer.userId)).toEqual(["OFFER_RECEIVED"]);
    expect(await alertKinds(buyer.userId)).toEqual([]);
    expect(await alertsFor(w.officer.userId)).toMatchObject([
      { role: "OFFICER", cooperativeId: w.cooperativeId, subjectType: "OFFER", subjectId: id, data: QTY },
    ]);
  });

  it("tells_the_buyer_their_offer_was_accepted", async () => {
    const id = await offer(ASK, "Can you hold it for me?");
    await clearAlerts();
    await respondToOffer(w.officer, id, { decision: "ACCEPT", message: "Yes, held." }, NOW);
    expect(await alertKinds(buyer.userId)).toEqual(["OFFER_ACCEPTED"]);
    expect(await alertKinds(w.officer.userId)).toEqual([]);
    expect(await alertsFor(buyer.userId)).toMatchObject([
      { role: "BUYER", cooperativeId: null, subjectId: id, data: QTY },
    ]);
  });

  it("asks_the_farmer_when_an_offer_below_the_floor_is_accepted", async () => {
    const id = await offer(5_000_000);
    await clearAlerts();
    await respondToOffer(w.officer, id, { decision: "ACCEPT" }, NOW);
    expect(await alertKinds(w.farmer.userId)).toEqual(["OFFER_NEEDS_FARMER"]);
    expect(await alertKinds(buyer.userId)).toEqual([]);
    const [row] = await alertsFor(w.farmer.userId);
    expect(row).toMatchObject({ role: "FARMER", cooperativeId: w.cooperativeId, subjectType: "LOT", subjectId: lotId });
    // The floor and the offered price stay out of the alert.
    expect(JSON.stringify(row.data)).not.toMatch(/5500000|5000000/);
  });

  it("tells_the_buyer_their_offer_was_declined", async () => {
    const id = await offer();
    await clearAlerts();
    await respondToOffer(w.officer, id, { decision: "REJECT" }, NOW);
    expect(await alertKinds(buyer.userId)).toEqual(["OFFER_DECLINED"]);
  });

  it("tells_the_buyer_their_offer_was_countered", async () => {
    const id = await offer(5_600_000);
    await clearAlerts();
    await respondToOffer(w.officer, id, { decision: "COUNTER", counterKobo: 6_200_000 }, NOW);
    expect(await alertKinds(buyer.userId)).toEqual(["OFFER_COUNTERED"]);
    expect(JSON.stringify(await alertsFor(buyer.userId))).not.toContain("6200000");
  });

  it.each([
    ["agreed", true, "OFFER_ACCEPTED"],
    ["refused", false, "OFFER_DECLINED"],
  ])("tells_buyer_and_officers_the_farmer_%s", async (_name, agree, buyerKind) => {
    const id = await offer(5_000_000);
    await respondToOffer(w.officer, id, { decision: "ACCEPT" }, NOW);
    await clearAlerts();
    await farmerRespondToOffer(w.farmer, id, agree, at(2 * HOUR));
    expect(await alertKinds(buyer.userId)).toEqual([buyerKind]);
    expect(await alertKinds(w.officer.userId)).toEqual(["OFFER_FARMER_ANSWERED"]);
    expect(await alertKinds(w.farmer.userId)).toEqual([]);
  });

  it.each([
    ["accepted", true],
    ["declined", false],
  ])("tells_officers_the_buyer_%s_a_counter", async (_name, accepted) => {
    const id = await offer(5_600_000);
    await respondToOffer(w.officer, id, { decision: "COUNTER", counterKobo: 6_200_000 }, NOW);
    await clearAlerts();
    await respondToCounter(buyer, id, accepted, at(HOUR));
    expect(await alertKinds(w.officer.userId)).toEqual(["OFFER_COUNTER_ANSWERED"]);
    expect(await alertKinds(buyer.userId)).toEqual([]);
  });

  it("tells_officers_an_offer_was_withdrawn", async () => {
    const id = await offer();
    await clearAlerts();
    await withdrawOffer(buyer, id, at(HOUR));
    expect(await alertKinds(w.officer.userId)).toEqual(["OFFER_WITHDRAWN"]);
  });

  it("tells_the_buyer_their_offer_expired_once", async () => {
    await offer();
    await clearAlerts();
    await expireOffers(at(49 * HOUR));
    await expireOffers(at(50 * HOUR));
    expect(await alertKinds(buyer.userId)).toEqual(["OFFER_EXPIRED"]);
  });

  it("a_note_with_an_offer_does_not_add_a_second_alert", async () => {
    await offer(ASK, "Can you deliver to Kano?");
    expect(await alertKinds(w.officer.userId)).toEqual(["OFFER_RECEIVED"]);
  });

  it("a_refused_change_writes_no_alert", async () => {
    const id = await offer();
    await respondToOffer(w.officer, id, { decision: "REJECT" }, NOW);
    const before = await prisma.notification.count();
    await expect(respondToOffer(w.officer, id, { decision: "ACCEPT" }, NOW)).rejects.toThrow();
    expect(await prisma.notification.count()).toBe(before);
  });
});
