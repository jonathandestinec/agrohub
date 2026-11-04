import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { makeOffer, respondToOffer } from "@/modules/marketplace/service";
import { getThread, listOwnThreads, openLotThread, postMessage } from "@/modules/messaging/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

const ASK = 6_500_000;
const FLOOR = 5_500_000;
const MINUTE = 60_000;
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
});

afterAll(cleanDatabase);

describe("buyer threads", () => {
  it("lets a buyer and the cooperative talk, showing the buyer only the cooperative's name", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await postMessage(buyer, threadId, "Can you deliver to Ibadan?", NOW);
    const officerView = await postMessage(w.officer, threadId, "Yes, for a delivery cost.", at(MINUTE));
    expect(officerView.title).toBe("Buyer u-buyer");
    expect(officerView.messages.map((m) => [m.side, m.author, m.mine])).toEqual([
      ["BUYER", "Buyer u-buyer", false],
      ["COOPERATIVE", "Officer u-officer", true],
    ]);

    const buyerView = await getThread(buyer, threadId);
    expect(buyerView).toMatchObject({ kind: "BUYER_COOPERATIVE", title: "Zaria Growers", lot: { id: lotId, crop: "Maize", unit: "Bag" } });
    expect(buyerView.messages.map((m) => [m.author, m.body, m.mine])).toEqual([
      ["Buyer u-buyer", "Can you deliver to Ibadan?", true],
      ["Zaria Growers", "Yes, for a delivery cost.", false],
    ]);
    const json = JSON.stringify(buyerView);
    expect(json).not.toContain("Officer u-officer");
    expect(json).not.toContain("Farmer u-farmer");
    expect(json).not.toContain(w.officer.userId);
  });

  it("returns the same thread when opened twice", async () => {
    const first = await openLotThread(buyer, lotId, NOW);
    const second = await openLotThread(buyer, lotId, NOW);
    expect(second.threadId).toBe(first.threadId);
    expect(await prisma.thread.count()).toBe(1);
  });

  it("other_buyers_thread_is_not_found", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    const other = await buyerMember("u-buyer-2");
    await expect(getThread(other, threadId)).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
    await expect(postMessage(other, threadId, "hello", NOW)).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
    await expect(getThread(w.farmer, threadId)).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
  });

  it("lets an admin read and write in any thread as AgroHub", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await postMessage(w.admin, threadId, "AgroHub support here.", NOW);
    const view = await getThread(buyer, threadId);
    expect(view.messages[0]).toMatchObject({ side: "ADMIN", author: "AgroHub" });
  });

  it("message_with_phone_number_is_refused", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await expect(postMessage(buyer, threadId, "call 08031234567", NOW)).rejects.toMatchObject({
      code: "MESSAGE_HAS_CONTACT",
    });
    await expect(postMessage(w.officer, threadId, "email us at coop@example.com", NOW)).rejects.toMatchObject({
      code: "MESSAGE_HAS_CONTACT",
    });
    expect(await prisma.message.count()).toBe(0);
  });

  it("officer_message_with_floor_is_refused", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await expect(postMessage(w.officer, threadId, "Our lowest is ₦55,000 a bag", NOW)).rejects.toMatchObject({
      code: "MESSAGE_MENTIONS_FLOOR",
    });
    expect(await prisma.message.count()).toBe(0);
    // The farmer and their officer may talk about the floor.
    const { threadId: farmerThread } = await openLotThread(w.farmer, lotId, NOW);
    await postMessage(w.officer, farmerThread, "Our lowest is ₦55,000 a bag", NOW);
    expect(await prisma.message.count()).toBe(1);
  });

  it("refuses an empty or overlong message", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await expect(postMessage(buyer, threadId, "   ", NOW)).rejects.toMatchObject({ code: "MESSAGE_LENGTH" });
    await expect(postMessage(buyer, threadId, "x".repeat(2001), NOW)).rejects.toMatchObject({ code: "MESSAGE_LENGTH" });
  });

  it("allows at most 30 messages an hour", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    for (let i = 0; i < 30; i += 1) await postMessage(buyer, threadId, `message ${i}`, at(i * 1000));
    await expect(postMessage(buyer, threadId, "one more", at(31_000))).rejects.toMatchObject({
      code: "MESSAGE_RATE_LIMIT",
    });
    await postMessage(buyer, threadId, "an hour later", at(61 * MINUTE));
  });

  it("lists each person's own threads, newest activity first", async () => {
    const other = await buyerMember("u-buyer-2");
    const a = await openLotThread(buyer, lotId, NOW);
    const b = await openLotThread(other, lotId, NOW);
    await postMessage(buyer, a.threadId, "first", NOW);
    await postMessage(other, b.threadId, "second", at(MINUTE));
    expect((await listOwnThreads(buyer)).map((t) => t.id)).toEqual([a.threadId]);
    const officerList = await listOwnThreads(w.officer);
    expect(officerList.map((t) => [t.id, t.lastMessage])).toEqual([
      [b.threadId, "second"],
      [a.threadId, "first"],
    ]);
  });
});

describe("farmer threads", () => {
  it("lets the farmer and an officer talk, and keeps buyers out", async () => {
    const { threadId } = await openLotThread(w.farmer, lotId, NOW);
    const fromOfficer = await openLotThread(w.officer, lotId, NOW);
    expect(fromOfficer.threadId).toBe(threadId);
    await postMessage(w.farmer, threadId, "Please sell the maize this week.", NOW);
    const view = await postMessage(w.officer, threadId, "Noted.", at(MINUTE));
    expect(view.kind).toBe("FARMER_COOPERATIVE");
    expect(view.messages.map((m) => m.side)).toEqual(["FARMER", "COOPERATIVE"]);
    await expect(getThread(buyer, threadId)).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
    expect((await listOwnThreads(w.farmer)).map((t) => t.id)).toEqual([threadId]);
  });
});

describe("messages sent with offer actions", () => {
  it("posts the buyer's offer note to the lot's buyer thread", async () => {
    await makeOffer(buyer, { lotId, quantity: 10, offeredKobo: 6_000_000, message: "Can you deliver?" }, NOW);
    const [thread] = await listOwnThreads(buyer);
    expect(thread.lastMessage).toBe("Can you deliver?");
  });

  it("refuses an offer whose note has a phone number, making no offer", async () => {
    await expect(
      makeOffer(buyer, { lotId, quantity: 10, offeredKobo: 6_000_000, message: "call 08031234567" }, NOW),
    ).rejects.toMatchObject({ code: "MESSAGE_HAS_CONTACT" });
    expect(await prisma.offer.count()).toBe(0);
  });

  it("refuses a rejection whose message names the floor and leaves the offer open", async () => {
    const offer = await makeOffer(buyer, { lotId, quantity: 10, offeredKobo: 5_000_000 }, NOW);
    await expect(
      respondToOffer(w.officer, offer.id, { decision: "REJECT", message: "We can't go below 55000" }, NOW),
    ).rejects.toMatchObject({ code: "MESSAGE_MENTIONS_FLOOR" });
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("OPEN");
    await respondToOffer(w.officer, offer.id, { decision: "REJECT", message: "Sorry, not at that price." }, NOW);
    const [thread] = await listOwnThreads(buyer);
    expect(thread.lastMessage).toBe("Sorry, not at that price.");
  });
});
