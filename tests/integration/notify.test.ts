import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import { notify } from "@/modules/notifications/service";
import {
  activeAdmins,
  activeBoardAdmins,
  buyer,
  farmer,
  farmersOfLot,
  officersOf,
  person,
  threadAudience,
} from "@/modules/notifications/recipients";
import { alertKinds, alertsFor } from "./alert-helpers";
import { cleanDatabase } from "./helpers";
import { buyerMember, farmerMember, lotWorld, NOW, officerMember, PHOTO, type LotWorld } from "./lot-fixtures";

let w: LotWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
});

afterAll(cleanDatabase);

const lotSubmitted = (to: Awaited<ReturnType<typeof officersOf>>, exclude?: string) =>
  notify(prisma, {
    kind: "LOT_SUBMITTED",
    subject: { type: "LOT", id: "lot-1" },
    data: { crop: "Maize" },
    to,
    exclude,
  });

describe("notify", () => {
  it("writes_one_row_per_recipient_and_none_for_the_actor", async () => {
    const second = await officerMember("u-officer-2", w.cooperativeId);
    await lotSubmitted(await officersOf(prisma, w.cooperativeId), w.officer.userId);
    expect(await alertKinds(second.userId)).toEqual(["LOT_SUBMITTED"]);
    expect(await alertKinds(w.officer.userId)).toEqual([]);
    const [row] = await alertsFor(second.userId);
    expect(row).toMatchObject({
      role: "OFFICER",
      cooperativeId: w.cooperativeId,
      readAt: null,
      subjectId: "lot-1",
      subjectType: "LOT",
      data: { crop: "Maize" },
    });
  });

  it("writes_nothing_and_does_not_fail_when_no_one_is_left", async () => {
    await expect(
      lotSubmitted(await officersOf(prisma, w.cooperativeId), w.officer.userId),
    ).resolves.toBeUndefined();
    expect(await prisma.notification.count()).toBe(0);
  });

  it("does_not_double_up_a_recipient_listed_twice", async () => {
    const b = await buyerMember("u-buyer");
    await notify(prisma, {
      kind: "OFFER_ACCEPTED",
      subject: { type: "OFFER", id: "offer-1" },
      data: { crop: "Maize", quantity: 4, unit: "Bag" },
      to: [buyer(b.userId), buyer(b.userId)],
    });
    expect(await alertKinds(b.userId)).toEqual(["OFFER_ACCEPTED"]);
  });

  it("rolls_back_with_the_transaction", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await notify(tx, {
          kind: "LOT_SUBMITTED",
          subject: { type: "LOT", id: "lot-1" },
          data: { crop: "Maize" },
          to: await officersOf(tx, w.cooperativeId),
        });
        expect(await tx.notification.count()).toBe(1);
        throw new Error("the change failed");
      }),
    ).rejects.toThrow("the change failed");
    expect(await prisma.notification.count()).toBe(0);
  });

  it("rejects_data_with_a_field_the_kind_does_not_have", async () => {
    await expect(
      notify(prisma, {
        kind: "LOT_SUBMITTED",
        subject: { type: "LOT", id: "lot-1" },
        // @ts-expect-error a floor price has no place in an alert
        data: { crop: "Maize", floorKobo: 5_000_000 },
        to: await officersOf(prisma, w.cooperativeId),
      }),
    ).rejects.toThrow();
    expect(await prisma.notification.count()).toBe(0);
  });

  it("keeps_one_unread_message_alert_per_thread", async () => {
    const send = () =>
      notify(prisma, {
        kind: "MESSAGE_RECEIVED",
        subject: { type: "THREAD", id: "thread-1" },
        data: { crop: "Maize" },
        to: [person(w.officer.userId)],
      });
    await send();
    const [first] = await alertsFor(w.officer.userId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await send();
    const rows = await alertsFor(w.officer.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].createdAt.getTime()).toBeGreaterThan(first.createdAt.getTime());
  });

  it("starts_a_new_message_alert_once_the_last_was_read", async () => {
    const send = () =>
      notify(prisma, {
        kind: "MESSAGE_RECEIVED",
        subject: { type: "THREAD", id: "thread-1" },
        data: { crop: "Maize" },
        to: [person(w.officer.userId)],
      });
    await send();
    await prisma.notification.updateMany({ data: { readAt: new Date() } });
    await send();
    expect(await alertsFor(w.officer.userId)).toHaveLength(2);
  });

  it("does_not_collapse_other_kinds", async () => {
    await lotSubmitted([person(w.officer.userId)]);
    await lotSubmitted([person(w.officer.userId)]);
    expect(await alertsFor(w.officer.userId)).toHaveLength(2);
  });
});

describe("recipient helpers", () => {
  it("lists_inactive_officers_and_admins_out", async () => {
    const second = await officerMember("u-officer-2", w.cooperativeId);
    await prisma.membership.updateMany({
      where: { userId: second.userId, role: "OFFICER" },
      data: { status: "REMOVED" },
    });
    expect((await officersOf(prisma, w.cooperativeId)).map((r) => r.userId)).toEqual([w.officer.userId]);
    // lotWorld gives the admin and board admin no membership rows, so create them here; a second
    // ADMIN membership for the same person still lists them once.
    await prisma.membership.create({ data: { userId: w.admin.userId, role: "ADMIN", status: "ACTIVE" } });
    await prisma.membership.create({ data: { userId: w.board.userId, role: "BOARD_ADMIN", status: "ACTIVE" } });
    await prisma.membership.create({
      data: { userId: w.admin.userId, role: "ADMIN", cooperativeId: w.cooperativeId, status: "ACTIVE" },
    });
    expect(await activeAdmins(prisma)).toEqual([{ userId: w.admin.userId, role: "ADMIN", cooperativeId: null }]);
    expect(await activeBoardAdmins(prisma)).toEqual([
      { userId: w.board.userId, role: "BOARD_ADMIN", cooperativeId: null },
    ]);
  });

  it("finds_every_farmer_on_a_lot", async () => {
    const lot = await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    const other = await farmerMember("u-farmer-2", w.cooperativeId);
    await prisma.lotContribution.create({ data: { lotId: lot.id, farmerUserId: other.userId, quantity: 5 } });
    const found = await farmersOfLot(prisma, lot.id);
    expect(found.map((r) => r.userId).sort()).toEqual([w.farmer.userId, other.userId].sort());
    for (const r of found) expect(r).toMatchObject({ role: "FARMER", cooperativeId: w.cooperativeId });
    expect(await farmersOfLot(prisma, "missing-lot")).toEqual([]);
    expect(farmer("x", "c")).toEqual({ userId: "x", role: "FARMER", cooperativeId: "c" });
  });

  it("finds_the_counterpart_and_officers_of_a_thread", async () => {
    const lot = await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
    const b = await buyerMember("u-buyer");
    const buyerThread = await prisma.thread.create({
      data: { kind: "BUYER_COOPERATIVE", lotId: lot.id, cooperativeId: w.cooperativeId, counterpartUserId: b.userId },
    });
    expect(await threadAudience(prisma, buyerThread.id)).toEqual(
      expect.arrayContaining([
        { userId: b.userId, role: "BUYER", cooperativeId: null },
        { userId: w.officer.userId, role: "OFFICER", cooperativeId: w.cooperativeId },
      ]),
    );
    const farmerThread = await prisma.thread.create({
      data: {
        kind: "FARMER_COOPERATIVE",
        lotId: lot.id,
        cooperativeId: w.cooperativeId,
        counterpartUserId: w.farmer.userId,
      },
    });
    expect(await threadAudience(prisma, farmerThread.id)).toEqual(
      expect.arrayContaining([{ userId: w.farmer.userId, role: "FARMER", cooperativeId: w.cooperativeId }]),
    );
    expect(await threadAudience(prisma, "missing")).toEqual([]);
  });
});
