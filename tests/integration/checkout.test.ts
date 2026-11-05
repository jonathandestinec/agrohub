import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { approveLot, availableQuantity, submitLot, withdrawLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { makeOffer, respondToOffer } from "@/modules/marketplace/service";
import { openLotThread } from "@/modules/messaging/service";
import { getOwnOrder, quoteDelivery, startCheckout } from "@/modules/orders/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, officerMember, PHOTO, type LotWorld } from "./lot-fixtures";

const MIN = 60_000;
const HOUR = 60 * MIN;
const ASK = 6_500_000;
let w: LotWorld;
let buyer: Actor;
let lotId: string;

const at = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  w = await lotWorld();
  buyer = await buyerMember("u-buyer");
  const lot = await submitLot(w.farmer, w.input({ quantity: 30, askKobo: ASK }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
  lotId = lot.id;
});

afterAll(cleanDatabase);

function buyNow(who: Actor, quantity: number, when = NOW, deliveryQuoteId?: string) {
  return startCheckout(who, { source: "LOT", lotId, quantity, deliveryQuoteId }, when);
}

describe("startCheckout from a lot", () => {
  it("creates an unpaid order with a 15-minute reservation and a Paystack transaction for the total", async () => {
    const since = new Date();
    const { orderId, authorizationUrl } = await buyNow(buyer, 10);
    expect(authorizationUrl).toMatch(/^\/dev\/paystack\/checkout\?reference=pay_/);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { reservation: true, payments: true } });
    expect(order).toMatchObject({ status: "PENDING_PAYMENT", quantity: 10, unitKobo: ASK, cutBps: 400, feeBps: 300, deliveryMethod: "PICKUP" });
    expect(order.totalKobo).toBe(BigInt(65_000_000));
    expect(order.reservation).toMatchObject({ quantity: 10, countsTowardStock: true, expiresAt: at(15 * MIN) });
    expect(order.payments).toHaveLength(1);
    const reference = order.payments[0].reference;
    expect(fakePaystack.transactions.get(reference)).toMatchObject({ amountKobo: 65_000_000, email: "u-buyer@example.com" });
    expect(await availableQuantity(lotId, NOW)).toBe(20);
    const audits = await prisma.auditLog.findMany({ where: { action: "order.checkout", createdAt: { gte: since } } });
    expect(audits.map((a) => a.meta)).toEqual([{ orderId, lotId, quantity: 10, unitKobo: ASK, totalKobo: 65_000_000 }]);
  });

  it("adds a delivery quote to the total, and a quote serves one order only", async () => {
    await openLotThread(buyer, lotId, NOW);
    const { quoteId } = await quoteDelivery(w.officer, { lotId, buyerUserId: buyer.userId, amountKobo: 2_500_000 }, NOW);
    const { orderId } = await buyNow(buyer, 10, NOW, quoteId);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({ deliveryMethod: "DELIVERY", deliveryQuoteId: quoteId });
    expect(order.totalKobo).toBe(BigInt(67_500_000));
    expect(order.deliveryKobo).toBe(BigInt(2_500_000));
    await expect(buyNow(buyer, 5, NOW, quoteId)).rejects.toMatchObject({ code: "QUOTE_NOT_USABLE" });
  });

  it("reservation_blocks_other_buyers until its 15 minutes pass", async () => {
    const other = await buyerMember("u-other");
    await buyNow(buyer, 25);
    await expect(buyNow(other, 10, at(MIN))).rejects.toMatchObject({ code: "NOT_ENOUGH_STOCK" });
    await expect(buyNow(other, 10, at(16 * MIN))).resolves.toMatchObject({ orderId: expect.any(String) });
  });

  it("concurrent_checkouts_never_oversell", async () => {
    const buyers = [buyer, await buyerMember("u-b2"), await buyerMember("u-b3")];
    const results = await Promise.allSettled(buyers.map((b) => buyNow(b, 12)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.map((r) => r.reason.code)).toEqual(["NOT_ENOUGH_STOCK"]);
  });

  it("refuses below the minimum order, the buyer's own cooperative, and non-buyers", async () => {
    await expect(buyNow(buyer, 4)).rejects.toMatchObject({ code: "BELOW_MIN_ORDER" });
    const officerBuyer = await buyerMember(w.officer.userId);
    await expect(buyNow(officerBuyer, 5)).rejects.toMatchObject({ code: "OWN_COOPERATIVE_LOT" });
    await expect(buyNow(w.farmer, 5)).rejects.toMatchObject({ name: "ForbiddenError" });
    void officerMember;
  });

  it("cancels the order and frees the stock when Paystack is unavailable", async () => {
    fakePaystack.down = true;
    await expect(buyNow(buyer, 30)).rejects.toMatchObject({ code: "PAYSTACK_UNAVAILABLE" });
    const order = await prisma.order.findFirstOrThrow({ where: { buyerUserId: buyer.userId } });
    expect(order).toMatchObject({ status: "CANCELLED", cancelReason: "PAYSTACK_UNAVAILABLE" });
    expect(await availableQuantity(lotId, NOW)).toBe(30);
  });

  it("never shows the buyer the floor or the farmer", async () => {
    const { orderId } = await buyNow(buyer, 10);
    const view = await getOwnOrder(buyer, orderId, NOW);
    expect(view).toMatchObject({ status: "AWAITING_PAYMENT", totalKobo: 65_000_000, goodsKobo: 65_000_000, reservedUntil: at(15 * MIN).toISOString() });
    const json = JSON.stringify(view);
    expect(json).not.toContain("6000000");
    expect(json).not.toContain(w.farmer.userId);
    expect(json).not.toContain("Farmer u-farmer");
    expect((await getOwnOrder(buyer, orderId, at(16 * MIN))).status).toBe("PAYMENT_EXPIRED");
  });
});

describe("startCheckout from an accepted offer", () => {
  async function accepted(quantity: number, price: number) {
    const offer = await makeOffer(buyer, { lotId, quantity, offeredKobo: price }, NOW);
    await respondToOffer(w.officer, offer.id, { decision: "ACCEPT" }, NOW);
    return offer.id;
  }

  it("pays the agreed price for the agreed quantity without reserving the stock twice", async () => {
    const offerId = await accepted(12, 6_000_000);
    const { orderId } = await startCheckout(buyer, { source: "OFFER", offerId }, at(MIN));
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { reservation: true } });
    expect(order).toMatchObject({ quantity: 12, unitKobo: 6_000_000, offerId });
    expect(order.totalKobo).toBe(BigInt(72_000_000));
    expect(order.reservation?.countsTowardStock).toBe(false);
    expect(await availableQuantity(lotId, at(MIN))).toBe(18);
  });

  it("a second checkout from the same offer replaces the first", async () => {
    const offerId = await accepted(12, 6_000_000);
    const first = await startCheckout(buyer, { source: "OFFER", offerId }, at(MIN));
    await startCheckout(buyer, { source: "OFFER", offerId }, at(2 * MIN));
    expect(await prisma.order.findUniqueOrThrow({ where: { id: first.orderId } })).toMatchObject({
      status: "CANCELLED",
      cancelReason: "REPLACED",
    });
  });

  it("refuses an offer that reads EXPIRED, and another buyer's offer", async () => {
    const offerId = await accepted(12, 6_000_000);
    await expect(startCheckout(buyer, { source: "OFFER", offerId }, at(25 * HOUR))).rejects.toMatchObject({ code: "OFFER_NOT_PAYABLE" });
    const other = await buyerMember("u-other");
    await expect(startCheckout(other, { source: "OFFER", offerId }, at(MIN))).rejects.toMatchObject({ code: "OFFER_NOT_FOUND" });
    await withdrawLot(w.farmer, lotId, at(2 * MIN));
    await expect(startCheckout(buyer, { source: "OFFER", offerId }, at(3 * MIN))).rejects.toMatchObject({ code: "OFFER_NOT_PAYABLE" });
  });
});
