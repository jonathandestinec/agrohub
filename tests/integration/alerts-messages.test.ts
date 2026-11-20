import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { makeOffer } from "@/modules/marketplace/service";
import { getThread, openLotThread, postMessage, postSystemMessage, readThread } from "@/modules/messaging/service";
import { quoteDelivery } from "@/modules/orders/service";
import { countOwnUnread } from "@/modules/notifications/service";
import { alertKinds, alertsFor } from "./alert-helpers";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, officerMember, PHOTO, type LotWorld } from "./lot-fixtures";

const MINUTE = 60_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

let w: LotWorld;
let buyer: Actor;
let lotId: string;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
  buyer = await buyerMember("u-buyer");
  const lot = await submitLot(w.farmer, w.input({ askKobo: 6_500_000, floorKobo: 5_500_000 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
  lotId = lot.id;
  // Setting the lot up raised its own alerts; these tests look only at messages.
  await prisma.notification.deleteMany();
});

afterAll(cleanDatabase);

describe("message alerts", () => {
  it("tells_officers_when_the_buyer_writes", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await postMessage(buyer, threadId, "Is the maize still dry?", NOW);
    expect(await alertKinds(w.officer.userId)).toEqual(["MESSAGE_RECEIVED"]);
    expect(await alertKinds(buyer.userId)).toEqual([]);
    expect(await alertsFor(w.officer.userId)).toMatchObject([
      { role: "OFFICER", cooperativeId: w.cooperativeId, subjectType: "THREAD", subjectId: threadId, data: { crop: "Maize" } },
    ]);
  });

  it("tells_the_buyer_when_an_officer_writes", async () => {
    const second = await officerMember("u-officer-2", w.cooperativeId);
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await postMessage(w.officer, threadId, "Yes, it is dry.", at(MINUTE));
    expect(await alertsFor(buyer.userId)).toMatchObject([{ kind: "MESSAGE_RECEIVED", role: "BUYER", cooperativeId: null }]);
    expect(await alertKinds(second.userId)).toEqual(["MESSAGE_RECEIVED"]);
    expect(await alertKinds(w.officer.userId)).toEqual([]);
  });

  it("tells_the_farmer_on_a_farmer_thread", async () => {
    const { threadId } = await openLotThread(w.farmer, lotId, NOW);
    await postMessage(w.officer, threadId, "Please bring the lot on Friday.", at(MINUTE));
    expect(await alertsFor(w.farmer.userId)).toMatchObject([
      { kind: "MESSAGE_RECEIVED", role: "FARMER", cooperativeId: w.cooperativeId, subjectId: threadId },
    ]);
    // A buyer is never on a farmer thread.
    expect(await alertKinds(buyer.userId)).toEqual([]);
  });

  it("keeps_one_unread_alert_however_many_messages", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    for (let i = 0; i < 3; i += 1) await postMessage(w.officer, threadId, `Reply number ${i}`, at(i * MINUTE));
    expect(await alertsFor(buyer.userId)).toHaveLength(1);
  });

  it("a_system_message_raises_no_message_alert", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await postSystemMessage(threadId, w.officer.userId, "The order was marked delivered.", at(MINUTE));
    expect(await prisma.notification.count()).toBe(0);
  });

  it("a_note_sent_with_an_offer_raises_no_message_alert", async () => {
    await makeOffer(buyer, { lotId, quantity: 10, offeredKobo: 6_500_000, message: "Can you deliver to Kano?" }, NOW);
    expect(await alertKinds(w.officer.userId)).toEqual(["OFFER_RECEIVED"]);
  });

  it("a_delivery_quote_raises_no_message_alert", async () => {
    await openLotThread(buyer, lotId, NOW);
    await quoteDelivery(w.officer, { lotId, buyerUserId: buyer.userId, amountKobo: 250_000 }, at(MINUTE));
    expect(await alertKinds(buyer.userId)).toEqual(["DELIVERY_QUOTED"]);
  });

  it("a_refused_message_writes_no_alert", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await expect(postMessage(buyer, threadId, "Call me on 08031234567", NOW)).rejects.toThrow();
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe("opening a thread clears its message alert", () => {
  it("clears_the_viewers_alert_for_that_thread_and_the_bell_count_drops", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await postMessage(w.officer, threadId, "Yes, it is dry.", at(MINUTE));
    expect(await countOwnUnread(buyer)).toBe(1);
    const view = await readThread(buyer, threadId);
    expect(view.id).toBe(threadId);
    expect(await countOwnUnread(buyer)).toBe(0);
    expect((await alertsFor(buyer.userId))[0].readAt).not.toBeNull();
  });

  it("a_plain_getThread_still_writes_nothing", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await postMessage(w.officer, threadId, "Yes, it is dry.", at(MINUTE));
    await getThread(buyer, threadId);
    expect(await countOwnUnread(buyer)).toBe(1);
  });

  it("leaves_the_other_participants_alerts_alone", async () => {
    const second = await officerMember("u-officer-2", w.cooperativeId);
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await postMessage(buyer, threadId, "Is the maize dry?", at(MINUTE));
    await readThread(second, threadId);
    expect(await countOwnUnread(second)).toBe(0);
    expect(await countOwnUnread(w.officer)).toBe(1);
  });

  it("leaves_the_alert_of_another_thread_alone", async () => {
    const buyerThread = (await openLotThread(buyer, lotId, NOW)).threadId;
    const farmerThread = (await openLotThread(w.farmer, lotId, NOW)).threadId;
    await postMessage(buyer, buyerThread, "Is the maize dry?", at(MINUTE));
    await postMessage(w.farmer, farmerThread, "I can bring it Friday.", at(2 * MINUTE));
    expect(await countOwnUnread(w.officer)).toBe(2);
    await readThread(w.officer, buyerThread);
    expect(await countOwnUnread(w.officer)).toBe(1);
  });

  it("a_stranger_cannot_open_the_thread_and_clears_nothing", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await postMessage(w.officer, threadId, "Yes, it is dry.", at(MINUTE));
    const stranger = await buyerMember("u-stranger");
    await expect(readThread(stranger, threadId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await countOwnUnread(buyer)).toBe(1);
  });

  it("opening_twice_is_harmless_and_a_new_message_raises_a_new_alert", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await postMessage(w.officer, threadId, "First.", at(MINUTE));
    await readThread(buyer, threadId);
    await readThread(buyer, threadId);
    expect(await countOwnUnread(buyer)).toBe(0);
    await postMessage(w.officer, threadId, "Second.", at(2 * MINUTE));
    expect(await countOwnUnread(buyer)).toBe(1);
  });
});
