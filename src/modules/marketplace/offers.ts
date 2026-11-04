import type { Offer, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/audit";
import {
  committedQuantity,
  isPubliclyVisible,
  lockLot,
  lotNegotiationFacts,
  publiclyVisibleWhere,
  type NegotiationFacts,
} from "@/modules/catalog/service";
import { can, type Actor } from "@/modules/identity/policies";
import { holdsCooperativeRole } from "@/modules/identity/service";
import { assertMessageAllowed, assertMessageRateOk, postToBuyerThread } from "@/modules/messaging/service";
import {
  HOUR_MS,
  OFFER_TTL_HOURS,
  OFFERS_PER_HOUR,
  OFFERS_PER_LOT_PER_DAY,
  hoursAfter,
  lockUser,
} from "./limits";
import { makeOfferInput, type MakeOfferInput } from "./schema";
import { toBuyerOffer, type BuyerOffer, type OfferLotSummary } from "./views";

// Offers still waiting for an answer from someone.
export const LIVE_OFFER = ["OPEN", "AWAITING_FARMER", "COUNTERED"] as const;

// The lot fields offer views and visibility need, loaded with each offer.
export const OFFER_LOT = {
  lot: {
    select: {
      id: true,
      status: true,
      availableUntil: true,
      crop: { select: { name: true } },
      unit: { select: { name: true } },
      cooperative: { select: { name: true, status: true } },
    },
  },
} as const;

export type OfferWithLot = Prisma.OfferGetPayload<{ include: typeof OFFER_LOT }>;

export function lotSummaryOf(offer: OfferWithLot): OfferLotSummary {
  return {
    id: offer.lot.id,
    crop: offer.lot.crop.name,
    unit: offer.lot.unit.name,
    cooperativeName: offer.lot.cooperative.name,
  };
}

export function buyerViewOf(offer: OfferWithLot, now: Date): BuyerOffer {
  return toBuyerOffer(offer, lotSummaryOf(offer), isPubliclyVisible(offer.lot, now), now);
}

function invalid(issues: { message: string }[]): ValidationError {
  return new ValidationError(issues.map((issue) => issue.message).join("; "), "INVALID_OFFER");
}

// A lot a buyer may make an offer on, or ConflictError LOT_NOT_AVAILABLE (a missing lot looks
// the same as one that is not on sale).
async function availableLot(lotId: string, now: Date): Promise<NegotiationFacts> {
  try {
    const facts = await lotNegotiationFacts(lotId, now);
    if (facts.publiclyVisible) return facts;
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  throw new ConflictError("Lot is not on sale", "LOT_NOT_AVAILABLE");
}

// A buyer offers a price per unit for a whole quantity. Nothing here compares the offer with
// the floor: an offer below it is taken, answered and shown exactly like any other.
export async function makeOffer(
  actor: Actor,
  input: MakeOfferInput,
  now: Date = new Date(),
): Promise<BuyerOffer> {
  if (!can(actor, "offer:make")) throw new ForbiddenError();
  const parsed = makeOfferInput.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues);
  const { lotId, quantity, offeredKobo, message } = parsed.data;
  const lot = await availableLot(lotId, now);
  if (await holdsCooperativeRole(actor.userId, lot.cooperativeId)) {
    throw new ForbiddenError("OWN_COOPERATIVE_LOT");
  }
  if (offeredKobo > lot.askKobo) throw new ValidationError("Offer is above the asking price", "OFFER_ABOVE_ASK");
  if (quantity < lot.minOrderQty) throw new ValidationError("Below the minimum order", "BELOW_MIN_ORDER");
  const note = message?.trim() ? message : null;
  if (note) {
    assertMessageAllowed(actor, { kind: "BUYER_COOPERATIVE", floorKobo: lot.floorKobo, quantities: [quantity] }, note);
    await assertMessageRateOk(actor, now);
  }

  const offer = await prisma.$transaction(async (tx) => {
    await lockUser(tx, actor.userId);
    // Acceptances lock the lot too, so an earlier offer cannot be accepted between the read of
    // the buyer's live offers below and their withdrawal.
    await lockLot(tx, lotId);
    const lastHour = await tx.offer.count({
      where: { buyerUserId: actor.userId, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
    });
    if (lastHour >= OFFERS_PER_HOUR) throw new ValidationError("Too many offers", "OFFER_RATE_LIMIT");
    const lastDayOnLot = await tx.offer.count({
      where: { buyerUserId: actor.userId, lotId, createdAt: { gt: new Date(now.getTime() - 24 * HOUR_MS) } },
    });
    if (lastDayOnLot >= OFFERS_PER_LOT_PER_DAY) {
      throw new ValidationError("Too many offers on this lot", "OFFER_LOT_LIMIT");
    }
    if (quantity > lot.quantity - (await committedQuantity(tx, lotId, now))) {
      throw new ConflictError("Not enough stock", "NOT_ENOUGH_STOCK");
    }
    const replaced = await tx.offer.findMany({
      where: { buyerUserId: actor.userId, lotId, status: { in: [...LIVE_OFFER] } },
      select: { id: true },
    });
    const created = await tx.offer.create({
      data: {
        lotId,
        cooperativeId: lot.cooperativeId,
        buyerUserId: actor.userId,
        quantity,
        offeredKobo,
        expiresAt: hoursAfter(now, OFFER_TTL_HOURS),
        createdAt: now,
      },
      include: OFFER_LOT,
    });
    // One live offer per buyer per lot: a new offer replaces the earlier one.
    for (const old of replaced) {
      const { count } = await tx.offer.updateMany({
        where: { id: old.id, status: { in: [...LIVE_OFFER] } },
        data: { status: "WITHDRAWN", decidedAt: now },
      });
      if (count === 0) continue;
      await recordAudit(
        {
          actorId: actor.userId,
          action: "offer.withdraw",
          entity: "offer",
          entityId: old.id,
          meta: { offerId: old.id, replacedBy: created.id },
        },
        tx,
      );
    }
    await recordAudit(
      {
        actorId: actor.userId,
        action: "offer.make",
        entity: "offer",
        entityId: created.id,
        meta: { offerId: created.id, lotId, quantity, offeredKobo },
      },
      tx,
    );
    return created;
  });
  if (note) await postToBuyerThread(actor, lotId, actor.userId, note, now);
  return buyerViewOf(offer, now);
}

export async function listOwnOffers(actor: Actor, now: Date = new Date()): Promise<BuyerOffer[]> {
  if (!can(actor, "offer:own", { ownerUserId: actor.userId })) throw new ForbiddenError();
  const offers = await prisma.offer.findMany({
    where: { buyerUserId: actor.userId },
    include: OFFER_LOT,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 100,
  });
  return offers.map((offer) => buyerViewOf(offer, now));
}

// The buyer's own offer row; another buyer's offer and a missing one look the same.
export async function loadOwnOffer(actor: Actor, offerId: string): Promise<OfferWithLot> {
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, include: OFFER_LOT });
  if (!offer || !can(actor, "offer:own", { ownerUserId: offer.buyerUserId })) {
    throw new NotFoundError("OFFER_NOT_FOUND");
  }
  return offer;
}

export async function getOwnOffer(actor: Actor, offerId: string, now: Date = new Date()): Promise<BuyerOffer> {
  return buyerViewOf(await loadOwnOffer(actor, offerId), now);
}

// The daily offer-expiry job: offers still waiting for an answer after 48 hours, accepted offers
// whose 24 hours to pay have passed, and either kind on a lot no longer on sale, become EXPIRED. Every
// action already refuses such offers before this runs. Safe to run twice: each update is
// conditional on the status it read. Returns how many offers it expired.
export async function expireOffers(now: Date = new Date()): Promise<number> {
  const due = await prisma.offer.findMany({
    where: {
      OR: [
        { status: { in: [...LIVE_OFFER] }, expiresAt: { lte: now } },
        { status: { in: [...LIVE_OFFER, "ACCEPTED"] }, lot: { NOT: publiclyVisibleWhere(now) } },
        { status: "ACCEPTED", payByAt: { lte: now } },
      ],
    },
    select: { id: true, status: true },
  });
  let expired = 0;
  for (const offer of due) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.offer.updateMany({
        where: { id: offer.id, status: offer.status },
        data: { status: "EXPIRED", decidedAt: now },
      });
      if (count === 0) return;
      expired += 1;
      await recordAudit(
        {
          actorId: null,
          action: "offer.expire",
          entity: "offer",
          entityId: offer.id,
          meta: { offerId: offer.id, fromStatus: offer.status },
        },
        tx,
      );
    });
  }
  return expired;
}

// For checkout (orders module): the buyer's own offer, its agreed price and what the buyer sees of
// its status. Checkout takes only an offer that reads ACCEPTED here.
export async function checkoutFactsForOffer(
  actor: Actor,
  offerId: string,
  now: Date = new Date(),
): Promise<{ id: string; lotId: string; quantity: number; agreedKobo: number; status: BuyerOffer["status"] }> {
  const offer = await loadOwnOffer(actor, offerId);
  return {
    id: offer.id,
    lotId: offer.lotId,
    quantity: offer.quantity,
    agreedKobo: offer.agreedKobo ?? offer.offeredKobo,
    status: buyerViewOf(offer, now).status,
  };
}

// For payment confirmation (payments module): the offer's order was paid, so the order holds
// the stock now. An offer that expired while its payment was landing becomes ORDERED too.
export async function markOfferOrdered(tx: Prisma.TransactionClient, offerId: string, now: Date): Promise<void> {
  const { count } = await tx.offer.updateMany({
    where: { id: offerId, status: { in: ["ACCEPTED", "EXPIRED"] } },
    data: { status: "ORDERED", decidedAt: now },
  });
  if (count === 0) return;
  await recordAudit(
    { actorId: null, action: "offer.ordered", entity: "offer", entityId: offerId, meta: { offerId } },
    tx,
  );
}

export type { Offer };
