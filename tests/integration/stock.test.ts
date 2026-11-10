import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeStorage } from "@/lib/storage";
import {
  approveLot,
  availableQuantity,
  committedQuantity,
  decideRevision,
  requestRevision,
  submitLot,
  withdrawLot,
} from "@/modules/catalog/service";
import { hasOpenOrders } from "@/modules/catalog/orders-guard";
import { leaveCooperative } from "@/modules/farmers/service";
import type { Actor } from "@/modules/identity/policies";
import { makeOffer, respondToOffer } from "@/modules/marketplace/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";
import { seedOrder } from "./order-fixtures";

const MIN = 60_000;
let w: LotWorld;
let buyer: Actor;
let other: Actor;
let lotId: string;

const at = (ms: number) => new Date(NOW.getTime() + ms);
const committed = (when = NOW) => committedQuantity(prisma, lotId, when);

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
  buyer = await buyerMember("u-buyer");
  other = await buyerMember("u-other");
  const lot = await submitLot(w.farmer, w.input({ quantity: 30 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
  lotId = lot.id;
});

afterAll(cleanDatabase);

async function acceptedOffer(quantity: number): Promise<string> {
  const offer = await makeOffer(buyer, { lotId, quantity, offeredKobo: 6_500_000 }, NOW);
  await respondToOffer(w.officer, offer.id, { decision: "ACCEPT" }, NOW);
  return offer.id;
}

describe("committedQuantity", () => {
  it("counts accepted offers, live reservations and paid orders", async () => {
    await acceptedOffer(12);
    expect(await committed()).toBe(12);
    await seedOrder({ lotId, buyerUserId: other.userId, quantity: 10, status: "PENDING_PAYMENT", reservation: { expiresAt: at(15 * MIN) } });
    expect(await committed()).toBe(22);
    expect(await availableQuantity(lotId, NOW)).toBe(8);
    expect(await committed(at(16 * MIN))).toBe(12);
  });

  it("adds nothing for a checkout from an accepted offer, which already holds its stock", async () => {
    const offerId = await acceptedOffer(12);
    await seedOrder({
      lotId,
      buyerUserId: buyer.userId,
      quantity: 12,
      status: "PENDING_PAYMENT",
      offerId,
      reservation: { expiresAt: at(15 * MIN), countsTowardStock: false },
    });
    expect(await committed()).toBe(12);
  });

  it("counts a paid order, by the delivered quantity once it is set, and never a cancelled or refunded one", async () => {
    const orderId = await seedOrder({ lotId, buyerUserId: other.userId, quantity: 8, status: "PAID_HELD" });
    expect(await committed()).toBe(8);
    await prisma.order.update({ where: { id: orderId }, data: { deliveredQuantity: 6, status: "DELIVERED_MARKED" } });
    expect(await committed()).toBe(6);
    await seedOrder({ lotId, buyerUserId: other.userId, quantity: 5, status: "REFUNDED" });
    await seedOrder({ lotId, buyerUserId: other.userId, quantity: 5, status: "CANCELLED" });
    expect(await committed()).toBe(6);
  });

  it("an offer cannot take stock already committed", async () => {
    await acceptedOffer(12);
    await expect(makeOffer(other, { lotId, quantity: 19, offeredKobo: 6_500_000 }, NOW)).rejects.toMatchObject({
      code: "NOT_ENOUGH_STOCK",
    });
    await expect(makeOffer(other, { lotId, quantity: 18, offeredKobo: 6_500_000 }, NOW)).resolves.toBeTruthy();
  });

  it("an acceptance cannot take stock a paid order holds", async () => {
    await seedOrder({ lotId, buyerUserId: other.userId, quantity: 25, status: "PAID_HELD" });
    const offer = await makeOffer(buyer, { lotId, quantity: 5, offeredKobo: 6_500_000 }, NOW);
    await seedOrder({ lotId, buyerUserId: other.userId, quantity: 1, status: "PAID_HELD" });
    await expect(respondToOffer(w.officer, offer.id, { decision: "ACCEPT" }, NOW)).rejects.toMatchObject({
      code: "NOT_ENOUGH_STOCK",
    });
  });
});

describe("open-order guards", () => {
  it("hasOpenOrders is false for a completed order and true for a disputed one", async () => {
    await seedOrder({ lotId, buyerUserId: other.userId, quantity: 5, status: "COMPLETED" });
    expect(await hasOpenOrders(lotId)).toBe(false);
    await seedOrder({ lotId, buyerUserId: other.userId, quantity: 5, status: "DISPUTED" });
    expect(await hasOpenOrders(lotId)).toBe(true);
  });

  it("an unpaid checkout counts as open only while its reservation lasts", async () => {
    await seedOrder({ lotId, buyerUserId: other.userId, quantity: 5, status: "PENDING_PAYMENT", reservation: { expiresAt: new Date(Date.now() + 15 * MIN) } });
    expect(await hasOpenOrders(lotId)).toBe(true);
  });

  it("a lot with a paid order cannot be withdrawn and its farmer cannot leave", async () => {
    await seedOrder({ lotId, buyerUserId: other.userId, quantity: 5, status: "PAID_HELD" });
    await expect(withdrawLot(w.farmer, lotId, NOW)).rejects.toMatchObject({ code: "LOT_HAS_OPEN_ORDERS" });
    await expect(leaveCooperative(w.farmer)).rejects.toMatchObject({ code: "UNFINISHED_ORDERS" });
  });

  it("a revision cannot lower the quantity below what is committed", async () => {
    await seedOrder({ lotId, buyerUserId: other.userId, quantity: 12, status: "PAID_HELD" });
    const pending = await requestRevision(w.farmer, lotId, { askKobo: 6_500_000, quantity: 10, floorKobo: 6_000_000 }, NOW);
    await expect(decideRevision(w.officer, pending.pendingRevision!.id, { approve: true }, NOW)).rejects.toMatchObject({
      code: "QUANTITY_BELOW_COMMITTED",
    });
  });
});
