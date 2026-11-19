import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { openLotThread, postMessage } from "@/modules/messaging/service";
import { alertsVersion, markAllRead, markRead, notify } from "@/modules/notifications/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

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
  await prisma.notification.deleteMany();
});

afterAll(cleanDatabase);

const pause = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

const offerAlert = (userId: string, id: string) =>
  notify(prisma, {
    kind: "OFFER_ACCEPTED",
    subject: { type: "OFFER", id },
    data: { crop: "Maize", quantity: 4, unit: "Bag" },
    to: [{ userId, role: "BUYER", cooperativeId: null }],
  });

describe("alertsVersion", () => {
  it("is_the_same_when_nothing_happens", async () => {
    await offerAlert(buyer.userId, "offer-1");
    expect(await alertsVersion(buyer)).toBe(await alertsVersion(buyer));
  });

  it("changes_when_a_new_alert_arrives", async () => {
    const before = await alertsVersion(buyer);
    await pause();
    await offerAlert(buyer.userId, "offer-1");
    expect(await alertsVersion(buyer)).not.toBe(before);
  });

  it("changes_when_the_alert_is_read_somewhere_else", async () => {
    await offerAlert(buyer.userId, "offer-1");
    const before = await alertsVersion(buyer);
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: buyer.userId } });
    await markRead(buyer, row.id);
    expect(await alertsVersion(buyer)).not.toBe(before);
    await offerAlert(buyer.userId, "offer-2");
    const withTwo = await alertsVersion(buyer);
    await markAllRead(buyer);
    expect(await alertsVersion(buyer)).not.toBe(withTwo);
  });

  it("changes_when_a_repeat_message_collapses_into_the_same_unread_alert", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await postMessage(w.officer, threadId, "First reply.", NOW);
    const before = await alertsVersion(buyer);
    const unreadBefore = await prisma.notification.count({ where: { userId: buyer.userId, readAt: null } });
    await pause();
    await postMessage(w.officer, threadId, "Second reply.", new Date(NOW.getTime() + 60_000));
    const unreadAfter = await prisma.notification.count({ where: { userId: buyer.userId, readAt: null } });
    expect(unreadAfter).toBe(unreadBefore); // the count did not move
    expect(await alertsVersion(buyer)).not.toBe(before); // the version did
  });

  it("does_not_see_another_persons_alerts", async () => {
    const other = await buyerMember("u-other");
    const before = await alertsVersion(buyer);
    await pause();
    await offerAlert(other.userId, "offer-9");
    expect(await alertsVersion(buyer)).toBe(before);
  });

  it("only_counts_alerts_for_the_role_in_use", async () => {
    // An officer alert addressed to the officer role is not part of a farmer's version.
    const before = await alertsVersion(w.farmer);
    await pause();
    await notify(prisma, {
      kind: "OFFER_ACCEPTED",
      subject: { type: "OFFER", id: "offer-5" },
      data: { crop: "Maize", quantity: 4, unit: "Bag" },
      to: [{ userId: w.farmer.userId, role: "OFFICER", cooperativeId: w.cooperativeId }],
    });
    expect(await alertsVersion(w.farmer)).toBe(before);
  });
});
