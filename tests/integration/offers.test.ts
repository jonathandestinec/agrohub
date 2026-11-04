import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot, withdrawLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { getOwnOffer, listOwnOffers, makeOffer } from "@/modules/marketplace/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

const ASK = 6_500_000;
const FLOOR = 5_500_000;
const HOUR = 3_600_000;
let w: LotWorld;
let buyer: Actor;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
  buyer = await buyerMember("u-buyer");
});

afterAll(cleanDatabase);

async function live(overrides: Record<string, unknown> = {}) {
  const lot = await submitLot(w.farmer, w.input({ askKobo: ASK, floorKobo: FLOOR, ...overrides }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
  return lot;
}

const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("makeOffer", () => {
  it("records an open offer that the buyer sees as waiting, expiring in 48 hours", async () => {
    const lot = await live();
    const since = new Date();
    const offer = await makeOffer(buyer, { lotId: lot.id, quantity: 10, offeredKobo: 6_000_000 }, NOW);
    expect(offer).toMatchObject({
      lot: { id: lot.id, crop: "Maize", unit: "Bag", cooperativeName: "Zaria Growers" },
      quantity: 10,
      offeredKobo: 6_000_000,
      counterKobo: null,
      agreedKobo: null,
      totalKobo: 60_000_000,
      status: "WAITING",
      expiresAt: at(48 * HOUR).toISOString(),
      payByAt: null,
    });
    const row = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(row).toMatchObject({ status: "OPEN", cooperativeId: w.cooperativeId, buyerUserId: buyer.userId });
    const audits = await prisma.auditLog.findMany({ where: { action: "offer.make", createdAt: { gte: since } } });
    expect(audits).toHaveLength(1);
    expect(audits[0].meta).toEqual({ offerId: offer.id, lotId: lot.id, quantity: 10, offeredKobo: 6_000_000 });
  });

  it("takes an offer below the floor exactly like one above it", async () => {
    const lot = await live();
    const above = await makeOffer(buyer, { lotId: lot.id, quantity: 10, offeredKobo: 6_000_000 }, NOW);
    const other = await buyerMember("u-buyer-2");
    const below = await makeOffer(other, { lotId: lot.id, quantity: 10, offeredKobo: 5_000_000 }, NOW);
    const strip = (o: typeof above) => ({ ...o, id: "", offeredKobo: 0, totalKobo: 0, createdAt: "" });
    expect(strip(below)).toEqual(strip(above));
  });

  it("refuses a price above the ask, a quantity below the minimum order or above the lot", async () => {
    const lot = await live();
    await expect(
      makeOffer(buyer, { lotId: lot.id, quantity: 10, offeredKobo: ASK + 1 }, NOW),
    ).rejects.toMatchObject({ constructor: ValidationError, code: "OFFER_ABOVE_ASK" });
    await expect(
      makeOffer(buyer, { lotId: lot.id, quantity: 4, offeredKobo: 6_000_000 }, NOW),
    ).rejects.toMatchObject({ constructor: ValidationError, code: "BELOW_MIN_ORDER" });
    await expect(
      makeOffer(buyer, { lotId: lot.id, quantity: 31, offeredKobo: 6_000_000 }, NOW),
    ).rejects.toMatchObject({ constructor: ConflictError, code: "NOT_ENOUGH_STOCK" });
    await expect(
      makeOffer(buyer, { lotId: lot.id, quantity: 10, offeredKobo: 0 }, NOW),
    ).rejects.toMatchObject({ constructor: ValidationError });
  });

  it("refuses a lot that is not on sale", async () => {
    const lot = await live();
    await withdrawLot(w.farmer, lot.id);
    await expect(
      makeOffer(buyer, { lotId: lot.id, quantity: 10, offeredKobo: 6_000_000 }, NOW),
    ).rejects.toMatchObject({ constructor: ConflictError, code: "LOT_NOT_AVAILABLE" });
    await expect(
      makeOffer(buyer, { lotId: "no-such-lot", quantity: 10, offeredKobo: 6_000_000 }, NOW),
    ).rejects.toMatchObject({ code: "LOT_NOT_AVAILABLE" });
  });

  it("withdraws the buyer's earlier live offer on the same lot", async () => {
    const lot = await live();
    const first = await makeOffer(buyer, { lotId: lot.id, quantity: 10, offeredKobo: 5_000_000 }, NOW);
    const second = await makeOffer(buyer, { lotId: lot.id, quantity: 10, offeredKobo: 5_800_000 }, at(60_000));
    expect((await getOwnOffer(buyer, first.id, at(60_000))).status).toBe("WITHDRAWN");
    expect((await getOwnOffer(buyer, second.id, at(60_000))).status).toBe("WAITING");
    expect((await listOwnOffers(buyer, at(60_000))).map((o) => o.id)).toEqual([second.id, first.id]);
  });

  it("allows at most 10 offers an hour across lots", async () => {
    const lots = [await live(), await live(), await live()];
    for (let i = 0; i < 10; i += 1) {
      await makeOffer(buyer, { lotId: lots[i % 3].id, quantity: 5, offeredKobo: 6_000_000 }, at(i * 1000));
    }
    await expect(
      makeOffer(buyer, { lotId: lots[0].id, quantity: 5, offeredKobo: 6_000_000 }, at(20_000)),
    ).rejects.toMatchObject({ constructor: ValidationError, code: "OFFER_RATE_LIMIT" });
  });

  it("allows at most 5 offers on one lot in 24 hours", async () => {
    const lot = await live();
    for (let i = 0; i < 5; i += 1) {
      await makeOffer(buyer, { lotId: lot.id, quantity: 5, offeredKobo: 6_000_000 }, at(i * 61 * 60_000));
    }
    await expect(
      makeOffer(buyer, { lotId: lot.id, quantity: 5, offeredKobo: 6_000_000 }, at(5 * 61 * 60_000)),
    ).rejects.toMatchObject({ constructor: ValidationError, code: "OFFER_LOT_LIMIT" });
  });

  it("is for buyers only", async () => {
    const lot = await live();
    await expect(
      makeOffer(w.farmer, { lotId: lot.id, quantity: 10, offeredKobo: 6_000_000 }, NOW),
    ).rejects.toThrow(ForbiddenError);
  });

  it("cannot_offer_on_own_cooperative_lot", async () => {
    const lot = await live();
    await prisma.membership.create({ data: { userId: w.officer.userId, role: "BUYER", status: "ACTIVE" } });
    await prisma.user.update({ where: { id: w.officer.userId }, data: { emailVerified: true } });
    const officerAsBuyer: Actor = { userId: w.officer.userId, role: "BUYER", cooperativeId: null, twoFactorEnabled: true };
    await expect(
      makeOffer(officerAsBuyer, { lotId: lot.id, quantity: 10, offeredKobo: 6_000_000 }, NOW),
    ).rejects.toMatchObject({ constructor: ForbiddenError, code: "OWN_COOPERATIVE_LOT" });
  });
});

describe("getOwnOffer", () => {
  it("other_buyers_offer_is_not_found", async () => {
    const lot = await live();
    const offer = await makeOffer(buyer, { lotId: lot.id, quantity: 10, offeredKobo: 6_000_000 }, NOW);
    const other = await buyerMember("u-buyer-2");
    await expect(getOwnOffer(other, offer.id, NOW)).rejects.toMatchObject({
      constructor: NotFoundError,
      code: "OFFER_NOT_FOUND",
    });
    await expect(getOwnOffer(other, "no-such-offer", NOW)).rejects.toMatchObject({ code: "OFFER_NOT_FOUND" });
  });
});
