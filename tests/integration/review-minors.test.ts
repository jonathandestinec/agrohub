import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot, withdrawLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import {
  expireOffers,
  farmerRespondToOffer,
  getCooperativeOffer,
  getOwnOffer,
  makeOffer,
  respondToOffer,
  withdrawOffer,
} from "@/modules/marketplace/service";
import { openLotThread, postMessage } from "@/modules/messaging/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

// The minor findings from the Phase 4 review, each pinned by a test. Floor ₦55,000, ask ₦65,000.
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
  const lot = await submitLot(w.farmer, w.input({ askKobo: 6_500_000, floorKobo: FLOOR, quantity: 30 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
  lotId = lot.id;
});

afterAll(cleanDatabase);

describe("review minors", () => {
  it("withdraw_expired_offer_is_refused", async () => {
    const offer = await makeOffer(buyer, { lotId, quantity: 5, offeredKobo: 6_000_000 }, NOW);
    await expect(withdrawOffer(buyer, offer.id, at(49 * HOUR))).rejects.toMatchObject({ code: "OFFER_EXPIRED" });
    await withdrawLot(w.farmer, lotId);
    await expect(withdrawOffer(buyer, offer.id, at(HOUR))).rejects.toMatchObject({ code: "LOT_NOT_AVAILABLE" });
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("OPEN");
  });

  it("accepted_offer_on_off_sale_lot_reads_expired", async () => {
    const offer = await makeOffer(buyer, { lotId, quantity: 5, offeredKobo: 6_000_000 }, NOW);
    await respondToOffer(w.officer, offer.id, { decision: "ACCEPT" }, NOW);
    await withdrawLot(w.farmer, lotId);
    expect((await getOwnOffer(buyer, offer.id, at(HOUR))).status).toBe("EXPIRED");
    expect((await getCooperativeOffer(w.officer, offer.id, at(HOUR))).status).toBe("EXPIRED");
    expect(await expireOffers(at(HOUR))).toBe(1);
  });

  it("counter_note_naming_floor_or_phone_is_refused", async () => {
    const offer = await makeOffer(buyer, { lotId, quantity: 10, offeredKobo: 5_000_000 }, NOW);
    const counter = (message: string) =>
      respondToOffer(w.officer, offer.id, { decision: "COUNTER", counterKobo: 6_000_000, message }, NOW);
    await expect(counter("We can't go under ₦55,000")).rejects.toMatchObject({ code: "MESSAGE_MENTIONS_FLOOR" });
    await expect(counter("Call me on 0803 123 4567")).rejects.toMatchObject({ code: "MESSAGE_HAS_CONTACT" });
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("OPEN");
    expect(await prisma.message.count()).toBe(0);
  });

  it("message_naming_the_floor_as_a_line_total_is_refused", async () => {
    await makeOffer(buyer, { lotId, quantity: 10, offeredKobo: 5_000_000 }, NOW);
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    // ₦55,000 × 10 bags.
    await expect(postMessage(w.officer, threadId, "The lowest for your 10 bags is ₦550,000", NOW)).rejects.toMatchObject({
      code: "MESSAGE_MENTIONS_FLOOR",
    });
    await expect(postMessage(w.officer, threadId, "We could do around 55k a bag", NOW)).rejects.toMatchObject({
      code: "MESSAGE_MENTIONS_FLOOR",
    });
  });

  it("farmer_agree_racing_officer_accept_never_oversells", async () => {
    const referred = await makeOffer(buyer, { lotId, quantity: 20, offeredKobo: 5_000_000 }, NOW);
    await respondToOffer(w.officer, referred.id, { decision: "ACCEPT" }, NOW);
    const other = await buyerMember("u-buyer-2");
    const above = await makeOffer(other, { lotId, quantity: 20, offeredKobo: 6_000_000 }, NOW);
    const results = await Promise.allSettled([
      farmerRespondToOffer(w.farmer, referred.id, true, NOW),
      respondToOffer(w.officer, above.id, { decision: "ACCEPT" }, NOW),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failed?.reason).toMatchObject({ code: "NOT_ENOUGH_STOCK" });
    expect(await prisma.offer.count({ where: { lotId, status: "ACCEPTED" } })).toBe(1);
  });

  it("late_referral_is_refused", async () => {
    const offer = await makeOffer(buyer, { lotId, quantity: 5, offeredKobo: 5_000_000 }, NOW);
    await expect(respondToOffer(w.officer, offer.id, { decision: "ACCEPT" }, at(37 * HOUR))).rejects.toMatchObject({
      code: "REFERRAL_TOO_LATE",
    });
    await respondToOffer(w.officer, offer.id, { decision: "ACCEPT" }, at(36 * HOUR));
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("AWAITING_FARMER");
  });
});
