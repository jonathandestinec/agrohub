import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { getThread, openLotThread } from "@/modules/messaging/service";
import { listUsableQuotes, quoteDelivery } from "@/modules/orders/service";
import { cleanDatabase, createTestCooperative } from "./helpers";
import { buyerMember, lotWorld, NOW, officerMember, PHOTO, type LotWorld } from "./lot-fixtures";

const HOUR = 3_600_000;
let w: LotWorld;
let buyer: Actor;
let other: Actor;
let lotId: string;
let threadId: string;

const at = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
  buyer = await buyerMember("u-buyer");
  other = await buyerMember("u-other");
  const lot = await submitLot(w.farmer, w.input({ quantity: 30 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
  lotId = lot.id;
  threadId = (await openLotThread(buyer, lotId, NOW)).threadId;
});

afterAll(cleanDatabase);

describe("quoteDelivery", () => {
  it("posts the quote to the buyer's thread as the cooperative and offers it to that buyer only", async () => {
    const { quoteId } = await quoteDelivery(w.officer, { lotId, buyerUserId: buyer.userId, amountKobo: 2_500_000, note: "To Ibadan by truck" }, NOW);
    const thread = await getThread(buyer, threadId);
    const last = thread.messages.at(-1)!;
    expect(last.side).toBe("COOPERATIVE");
    expect(last.author).toBe("Zaria Growers");
    expect(last.body).toContain("Delivery quote: ₦25,000.00");
    expect(last.body).toContain("To Ibadan by truck");
    expect(await listUsableQuotes(buyer, lotId, at(HOUR))).toEqual([
      { id: quoteId, amountKobo: 2_500_000, note: "To Ibadan by truck", expiresAt: at(48 * HOUR).toISOString() },
    ]);
    expect(await listUsableQuotes(other, lotId, at(HOUR))).toEqual([]);
    expect(await listUsableQuotes(buyer, lotId, at(49 * HOUR))).toEqual([]);
    const audit = await prisma.auditLog.findFirst({ where: { action: "quote.make", entityId: quoteId } });
    expect(audit?.meta).toEqual({ quoteId, lotId, amountKobo: 2_500_000 });
  });

  it("needs a thread with that buyer, an amount in range and a clean note", async () => {
    await expect(quoteDelivery(w.officer, { lotId, buyerUserId: other.userId, amountKobo: 2_500_000 }, NOW)).rejects.toMatchObject({
      code: "NO_BUYER_THREAD",
    });
    for (const amountKobo of [0, 1_000_000_001, 1.5]) {
      await expect(quoteDelivery(w.officer, { lotId, buyerUserId: buyer.userId, amountKobo }, NOW)).rejects.toMatchObject({
        code: "QUOTE_RANGE",
      });
    }
    await expect(
      quoteDelivery(w.officer, { lotId, buyerUserId: buyer.userId, amountKobo: 2_500_000, note: "call 08031234567" }, NOW),
    ).rejects.toMatchObject({ code: "MESSAGE_HAS_CONTACT" });
    expect(await prisma.deliveryQuote.count()).toBe(0);
  });

  it("is only for officers of the lot's cooperative", async () => {
    const elsewhere = (await createTestCooperative({ name: "Other Co", status: "VERIFIED" })).id;
    const stranger = await officerMember("u-stranger", elsewhere);
    await expect(quoteDelivery(stranger, { lotId, buyerUserId: buyer.userId, amountKobo: 2_500_000 }, NOW)).rejects.toMatchObject({
      name: "ForbiddenError",
    });
    await expect(quoteDelivery(buyer, { lotId, buyerUserId: buyer.userId, amountKobo: 2_500_000 }, NOW)).rejects.toMatchObject({
      name: "ForbiddenError",
    });
  });
});
