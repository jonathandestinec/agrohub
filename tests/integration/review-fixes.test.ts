import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import { becomeBuyer } from "@/modules/identity/service";
import type { Actor } from "@/modules/identity/policies";
import { makeOffer, respondToOffer } from "@/modules/marketplace/service";
import { openLotThread, postMessage } from "@/modules/messaging/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

// Findings from the Phase 4 whole-branch review, each pinned by a test.
let w: LotWorld;
let buyer: Actor;
let lotId: string;
const at = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
  buyer = await buyerMember("u-buyer");
  const lot = await submitLot(w.farmer, w.input({ askKobo: 6_500_000, floorKobo: 5_500_000, quantity: 30 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
  lotId = lot.id;
});

afterAll(cleanDatabase);

describe("review fixes", () => {
  it("referral_note_is_refused_so_the_buyer_thread_stays_quiet", async () => {
    const offer = await makeOffer(buyer, { lotId, quantity: 10, offeredKobo: 5_000_000 }, NOW);
    await expect(
      respondToOffer(w.officer, offer.id, { decision: "ACCEPT", message: "Let me check with the farmer" }, NOW),
    ).rejects.toMatchObject({ code: "REFERRAL_NOTE_NOT_ALLOWED" });
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("OPEN");
    expect(await prisma.message.count()).toBe(0);
    // Without a note the referral goes through, and still nothing reaches the buyer's thread.
    await respondToOffer(w.officer, offer.id, { decision: "ACCEPT" }, NOW);
    expect(await prisma.message.count()).toBe(0);
  });

  it("new_offer_never_withdraws_an_offer_accepted_meanwhile", async () => {
    for (let i = 0; i < 8; i += 1) {
      // A day apart, so the per-lot offer limit never applies.
      const when = at(i * 25 * 3_600_000);
      const old = await makeOffer(buyer, { lotId, quantity: 1, offeredKobo: 6_000_000 }, when);
      const results = await Promise.allSettled([
        respondToOffer(w.officer, old.id, { decision: "ACCEPT" }, when),
        makeOffer(buyer, { lotId, quantity: 1, offeredKobo: 6_100_000 }, when),
      ]);
      const status = (await prisma.offer.findUniqueOrThrow({ where: { id: old.id } })).status;
      if (results[0].status === "fulfilled") expect(status).toBe("ACCEPTED");
    }
    // Eight rounds of three offer transactions: the alerts they now write add queries, which pushed
    // this over the 5-second default on the local Docker database.
  }, 30_000);

  it("note_over_the_message_limit_refuses_the_answer_and_stores_nothing", async () => {
    const offer = await makeOffer(buyer, { lotId, quantity: 10, offeredKobo: 5_000_000 }, NOW);
    const other = await buyerMember("u-buyer-2");
    const { threadId } = await openLotThread(other, lotId, NOW);
    for (let i = 0; i < 30; i += 1) await postMessage(w.officer, threadId, `reply ${i}`, at(i * 1000));
    await expect(
      respondToOffer(w.officer, offer.id, { decision: "REJECT", message: "Sorry, not at that price." }, at(40_000)),
    ).rejects.toMatchObject({ code: "MESSAGE_RATE_LIMIT" });
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("OPEN");
  });

  it("offer_note_over_the_message_limit_makes_no_offer", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    for (let i = 0; i < 30; i += 1) await postMessage(buyer, threadId, `note ${i}`, at(i * 1000));
    await expect(
      makeOffer(buyer, { lotId, quantity: 10, offeredKobo: 6_000_000, message: "One more note" }, at(40_000)),
    ).rejects.toMatchObject({ code: "MESSAGE_RATE_LIMIT" });
    expect(await prisma.offer.count({ where: { buyerUserId: buyer.userId } })).toBe(0);
  });

  it("removed_buyer_cannot_rejoin", async () => {
    const removed = await prisma.user.findUniqueOrThrow({ where: { id: "u-buyer" } });
    await prisma.membership.updateMany({ where: { userId: removed.id, role: "BUYER" }, data: { status: "REMOVED" } });
    await expect(becomeBuyer({ userId: removed.id })).rejects.toMatchObject({ code: "REMOVED_AS_BUYER" });
    // A buyer who left can come back.
    await prisma.membership.updateMany({ where: { userId: removed.id, role: "BUYER" }, data: { status: "LEFT" } });
    await becomeBuyer({ userId: removed.id });
    expect((await prisma.membership.findFirstOrThrow({ where: { userId: removed.id, role: "BUYER" } })).status).toBe("ACTIVE");
  });
});
