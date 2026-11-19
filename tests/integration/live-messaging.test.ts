import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { readTopics } from "@/modules/live/service";
import {
  inboxVersion,
  openLotThread,
  postMessage,
  postSystemMessage,
  threadVersion,
} from "@/modules/messaging/service";
import { cleanDatabase, createTestCooperative } from "./helpers";
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
});

afterAll(cleanDatabase);

describe("threadVersion", () => {
  it("changes_after_the_other_party_posts_and_not_otherwise", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    const first = await threadVersion(buyer, threadId);
    expect(await threadVersion(buyer, threadId)).toBe(first);
    await postMessage(w.officer, threadId, "Yes, it is dry.", at(MINUTE));
    const second = await threadVersion(buyer, threadId);
    expect(second).not.toBe(first);
    await postMessage(buyer, threadId, "Thank you.", at(2 * MINUTE));
    expect(await threadVersion(w.officer, threadId)).not.toBe(second);
  });

  it("changes_even_when_two_messages_share_a_timestamp", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await postMessage(w.officer, threadId, "One.", at(MINUTE));
    const before = await threadVersion(buyer, threadId);
    await postMessage(w.officer, threadId, "Two.", at(MINUTE));
    expect(await threadVersion(buyer, threadId)).not.toBe(before);
  });

  it("changes_on_a_system_message_too", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    const before = await threadVersion(buyer, threadId);
    await postSystemMessage(threadId, w.officer.userId, "The order was placed.", at(MINUTE));
    expect(await threadVersion(buyer, threadId)).not.toBe(before);
  });

  it("looks_missing_to_someone_who_is_not_in_the_thread", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    const otherBuyer = await buyerMember("u-buyer-2");
    const other = await createTestCooperative({ name: "Other cooperative" });
    const otherOfficer = await officerMember("u-officer-other", other.id);
    await expect(threadVersion(otherBuyer, threadId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(threadVersion(otherOfficer, threadId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(threadVersion(buyer, "no-such-thread")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a_farmer_cannot_read_a_buyer_thread", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await expect(threadVersion(w.farmer, threadId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reaches_readTopics_with_the_same_not_found_for_a_stranger", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    const otherBuyer = await buyerMember("u-buyer-2");
    const answers = await readTopics(otherBuyer, [{ key: `thread:${threadId}` }]);
    expect(answers[`thread:${threadId}`]).toEqual({ error: "not_found" });
    const own = await readTopics(buyer, [{ key: `thread:${threadId}` }]);
    expect(own[`thread:${threadId}`]).toEqual({ version: await threadVersion(buyer, threadId) });
  });
});

describe("inboxVersion", () => {
  it("changes_on_a_new_thread_and_on_a_new_last_message", async () => {
    const empty = await inboxVersion(buyer);
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    const withThread = await inboxVersion(buyer);
    expect(withThread).not.toBe(empty);
    await postMessage(buyer, threadId, "Is it dry?", at(MINUTE));
    const withMessage = await inboxVersion(buyer);
    expect(withMessage).not.toBe(withThread);
    expect(await inboxVersion(buyer)).toBe(withMessage);
  });

  it("is_scoped_like_the_inbox", async () => {
    const otherBuyer = await buyerMember("u-buyer-2");
    const before = await inboxVersion(otherBuyer);
    await openLotThread(buyer, lotId, NOW);
    expect(await inboxVersion(otherBuyer)).toBe(before);

    const other = await createTestCooperative({ name: "Other cooperative" });
    const otherOfficer = await officerMember("u-officer-other", other.id);
    const otherBefore = await inboxVersion(otherOfficer);
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await postMessage(buyer, threadId, "Hello", at(MINUTE));
    expect(await inboxVersion(otherOfficer)).toBe(otherBefore);
    expect(await inboxVersion(w.officer)).not.toBe(otherBefore);
  });

  it("an_officer_sees_a_farmer_thread_and_a_farmer_only_their_own", async () => {
    const officerBefore = await inboxVersion(w.officer);
    const farmerBefore = await inboxVersion(w.farmer);
    await openLotThread(w.farmer, lotId, NOW);
    expect(await inboxVersion(w.officer)).not.toBe(officerBefore);
    expect(await inboxVersion(w.farmer)).not.toBe(farmerBefore);
    const buyerThread = await openLotThread(buyer, lotId, at(MINUTE));
    const farmerNow = await inboxVersion(w.farmer);
    await postMessage(buyer, buyerThread.threadId, "Hello", at(2 * MINUTE));
    expect(await inboxVersion(w.farmer)).toBe(farmerNow);
  });

  it("is_forbidden_for_a_role_without_an_inbox", async () => {
    const board: Actor = { ...w.board };
    await expect(inboxVersion(board)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("a_read_does_not_write", () => {
  it("polling_a_version_changes_nothing", async () => {
    const { threadId } = await openLotThread(buyer, lotId, NOW);
    await postMessage(buyer, threadId, "Hello", at(MINUTE));
    const rows = await prisma.message.count();
    await threadVersion(w.officer, threadId);
    await inboxVersion(w.officer);
    expect(await prisma.message.count()).toBe(rows);
  });
});
