import type { OfferStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { saleBreakdown } from "@/lib/money";
import { recordAudit } from "@/modules/audit/audit";
import { committedQuantity, isPubliclyVisible, lockLot, lotNegotiationFacts } from "@/modules/catalog/service";
import { can, type Actor } from "@/modules/identity/policies";
import { assertMessageAllowed, assertMessageRateOk, postToBuyerThread } from "@/modules/messaging/service";
import { buyer as buyerRecipient, farmer, notify, officersOf } from "@/modules/notifications/service";
import { ACCEPT_HOLD_HOURS, OFFER_TTL_HOURS, REFERRAL_MIN_HOURS, hoursAfter } from "./limits";
import { LIVE_OFFER, buyerViewOf, loadOwnOffer } from "./offers";
import { respondToOfferInput, type RespondToOfferInput } from "./schema";
import { toFarmerOffer, toOfficerOffer, type BuyerOffer, type FarmerOffer, type OfficerOffer } from "./views";

// Offer rows with what the cooperative's and the farmer's views need, the floor included.
// These rows never reach a buyer-facing view.
const COOPERATIVE_OFFER = {
  buyer: { select: { name: true } },
  lot: {
    select: {
      id: true,
      status: true,
      availableUntil: true,
      askKobo: true,
      floorKobo: true,
      farmerUserId: true,
      quotedCutBps: true,
      quotedFeeBps: true,
      feeTerms: true,
      crop: { select: { name: true } },
      unit: { select: { name: true } },
      cooperative: { select: { name: true, status: true } },
    },
  },
} as const;

type CooperativeOfferRow = Prisma.OfferGetPayload<{ include: typeof COOPERATIVE_OFFER }>;

function officerViewOf(row: CooperativeOfferRow, now: Date): OfficerOffer {
  return toOfficerOffer(
    row,
    { crop: row.lot.crop.name, unit: row.lot.unit.name, askKobo: row.lot.askKobo, floorKobo: row.lot.floorKobo },
    row.buyer.name,
    isPubliclyVisible(row.lot, now),
    now,
  );
}

function farmerViewOf(row: CooperativeOfferRow, now: Date): FarmerOffer {
  const cut = row.lot.feeTerms?.cooperativeCutBps ?? row.lot.quotedCutBps;
  const fee = row.lot.feeTerms?.platformFeeBps ?? row.lot.quotedFeeBps;
  return toFarmerOffer(
    row,
    { crop: row.lot.crop.name, unit: row.lot.unit.name },
    saleBreakdown(row.offeredKobo, row.quantity, cut, fee),
    isPubliclyVisible(row.lot, now),
    now,
  );
}

async function loadCooperativeOffer(offerId: string): Promise<CooperativeOfferRow | null> {
  return prisma.offer.findUnique({ where: { id: offerId }, include: COOPERATIVE_OFFER });
}

// An offer on the officer's own cooperative's lot; any other looks missing.
async function loadOfferForOfficer(actor: Actor, offerId: string): Promise<CooperativeOfferRow> {
  const row = await loadCooperativeOffer(offerId);
  if (!row || !can(actor, "offer:respond", { cooperativeId: row.cooperativeId })) {
    throw new NotFoundError("OFFER_NOT_FOUND");
  }
  return row;
}

// What an offer alert needs. Quantity, crop and unit only: never a price.
type AlertOffer = {
  id: string;
  cooperativeId: string;
  buyerUserId: string;
  quantity: number;
  lot: { crop: { name: string }; unit: { name: string } };
};

function alertData(offer: AlertOffer) {
  return { crop: offer.lot.crop.name, quantity: offer.quantity, unit: offer.lot.unit.name };
}

// Tell the buyer how their offer was answered, inside the transaction that answered it.
async function tellBuyer(
  tx: Prisma.TransactionClient,
  kind: "OFFER_ACCEPTED" | "OFFER_COUNTERED" | "OFFER_DECLINED",
  offer: AlertOffer,
  actorId: string,
): Promise<void> {
  await notify(tx, {
    kind,
    subject: { type: "OFFER", id: offer.id },
    data: alertData(offer),
    to: [buyerRecipient(offer.buyerUserId)],
    exclude: actorId,
  });
}

// Tell the cooperative's officers what the buyer or the farmer did with an offer.
async function tellOfficers(
  tx: Prisma.TransactionClient,
  kind: "OFFER_COUNTER_ANSWERED" | "OFFER_FARMER_ANSWERED" | "OFFER_WITHDRAWN",
  offer: AlertOffer,
  actorId: string,
): Promise<void> {
  await notify(tx, {
    kind,
    subject: { type: "OFFER", id: offer.id },
    data: alertData(offer),
    to: await officersOf(tx, offer.cooperativeId),
    exclude: actorId,
  });
}

function assertNotExpired(expiresAt: Date, now: Date): void {
  if (expiresAt <= now) throw new ConflictError("Offer has expired", "OFFER_EXPIRED");
}

function notAvailable(): ConflictError {
  return new ConflictError("Lot is not on sale", "LOT_NOT_AVAILABLE");
}

// Accepts an offer from one waiting status at an agreed price per unit. The lot's row is locked
// first, so acceptances on one lot run one at a time and held stock can never pass the lot's
// quantity; the status condition makes a second answer to the same offer fail.
async function accept(
  tx: Prisma.TransactionClient,
  offer: { id: string; lotId: string; quantity: number },
  from: OfferStatus,
  agreedKobo: number,
  actorId: string,
  action: string,
  now: Date,
): Promise<void> {
  await lockLot(tx, offer.lotId);
  const lot = await lotNegotiationFacts(offer.lotId, now, tx);
  if (!lot.publiclyVisible) throw notAvailable();
  if (offer.quantity > lot.quantity - (await committedQuantity(tx, offer.lotId, now))) {
    throw new ConflictError("Not enough stock", "NOT_ENOUGH_STOCK");
  }
  const { count } = await tx.offer.updateMany({
    where: { id: offer.id, status: from, expiresAt: { gt: now } },
    data: {
      status: "ACCEPTED",
      agreedKobo,
      acceptedAt: now,
      payByAt: hoursAfter(now, ACCEPT_HOLD_HOURS),
      decidedByUserId: actorId,
      decidedAt: now,
    },
  });
  if (count === 0) throw new ConflictError("Offer was already answered", stateCode(from));
  await recordAudit(
    { actorId, action, entity: "offer", entityId: offer.id, meta: { offerId: offer.id, agreedKobo, quantity: offer.quantity } },
    tx,
  );
}

function stateCode(from: OfferStatus): string {
  if (from === "AWAITING_FARMER") return "OFFER_NOT_AWAITING_FARMER";
  if (from === "COUNTERED") return "OFFER_NOT_COUNTERED";
  return "OFFER_NOT_OPEN";
}

// Moves a live offer from one status to another and audits it, or fails with the state's code.
// The lot's row is locked and its visibility read again, and the update is conditional on the
// offer not having expired, so the checks callers make before the transaction still hold here.
async function move(
  tx: Prisma.TransactionClient,
  offer: { id: string; lotId: string },
  from: OfferStatus | readonly OfferStatus[],
  data: Prisma.OfferUpdateManyMutationInput,
  audit: { actorId: string; action: string; meta: Record<string, unknown> },
  code: string,
  now: Date,
): Promise<void> {
  await lockLot(tx, offer.lotId);
  if (!(await lotNegotiationFacts(offer.lotId, now, tx)).publiclyVisible) throw notAvailable();
  const offerId = offer.id;
  const { count } = await tx.offer.updateMany({
    where: { id: offerId, status: typeof from === "string" ? from : { in: [...from] }, expiresAt: { gt: now } },
    data,
  });
  if (count === 0) throw new ConflictError("Offer was already answered", code);
  await recordAudit({ ...audit, entity: "offer", entityId: offerId }, tx);
}

// The officer's answer to an open offer. Accepting at or above the floor accepts it; below
// the floor it goes to the farmer to agree, with its expiry unchanged so the buyer's view does
// not move. A counter must lie above the offer, at most the ask and at or above the floor, so
// it never needs the farmer.
export async function respondToOffer(
  actor: Actor,
  offerId: string,
  input: RespondToOfferInput,
  now: Date = new Date(),
): Promise<OfficerOffer> {
  const row = await loadOfferForOfficer(actor, offerId);
  const parsed = respondToOfferInput.safeParse(input);
  if (!parsed.success || (parsed.data.decision === "COUNTER" && parsed.data.counterKobo === undefined)) {
    throw new ValidationError("Invalid response", "INVALID_OFFER");
  }
  const { decision, counterKobo, message } = parsed.data;
  if (row.status !== "OPEN") throw new ConflictError("Offer was already answered", "OFFER_NOT_OPEN");
  assertNotExpired(row.expiresAt, now);
  if (!isPubliclyVisible(row.lot, now)) throw notAvailable();
  const { askKobo, floorKobo } = row.lot;
  const referral = decision === "ACCEPT" && row.offeredKobo < floorKobo;
  if (referral && row.expiresAt < hoursAfter(now, REFERRAL_MIN_HOURS)) {
    throw new ConflictError("Too little time left for the farmer to answer", "REFERRAL_TOO_LATE");
  }

  if (decision === "COUNTER") {
    const counter = counterKobo as number;
    if (counter <= row.offeredKobo) throw new ValidationError("Counter must be above the offer", "COUNTER_NOT_ABOVE_OFFER");
    if (counter > askKobo) throw new ValidationError("Counter is above the asking price", "COUNTER_ABOVE_ASK");
    if (counter < floorKobo) throw new ValidationError("Counter is below the floor", "COUNTER_BELOW_FLOOR");
  }
  // A note goes to the buyer's thread; it is checked first, so a refused note refuses the answer.
  const note = message?.trim() ? message : null;
  if (note) {
    // A note at the moment of a referral would tell the buyer the offer went somewhere other
    // than an answer, that is, below the floor; the buyer's view must not move.
    if (referral) {
      throw new ValidationError("No note when sending an offer to the farmer", "REFERRAL_NOTE_NOT_ALLOWED");
    }
    assertMessageAllowed(actor, { kind: "BUYER_COOPERATIVE", floorKobo, quantities: [row.quantity] }, note);
    await assertMessageRateOk(actor, now);
  }

  await prisma.$transaction(async (tx) => {
    if (decision === "ACCEPT" && !referral) {
      await accept(tx, row, "OPEN", row.offeredKobo, actor.userId, "offer.accept", now);
      await tellBuyer(tx, "OFFER_ACCEPTED", row, actor.userId);
    } else if (decision === "ACCEPT") {
      await move(
        tx,
        row,
        "OPEN",
        { status: "AWAITING_FARMER", referredByUserId: actor.userId },
        { actorId: actor.userId, action: "offer.refer", meta: { offerId: row.id } },
        "OFFER_NOT_OPEN",
        now,
      );
      // The buyer is told nothing yet (their view must not move); the farmer is asked.
      await notify(tx, {
        kind: "OFFER_NEEDS_FARMER",
        subject: { type: "LOT", id: row.lotId },
        data: alertData(row),
        // Only the farmer who submitted the lot can answer (farmerRespondToOffer checks lot:own),
        // so a contributor is not told an offer is below the floor.
        to: [farmer(row.lot.farmerUserId, row.cooperativeId)],
        exclude: actor.userId,
      });
    } else if (decision === "REJECT") {
      await move(
        tx,
        row,
        "OPEN",
        { status: "REJECTED", decidedByUserId: actor.userId, decidedAt: now },
        { actorId: actor.userId, action: "offer.reject", meta: { offerId: row.id } },
        "OFFER_NOT_OPEN",
        now,
      );
      await tellBuyer(tx, "OFFER_DECLINED", row, actor.userId);
    } else {
      await move(
        tx,
        row,
        "OPEN",
        { status: "COUNTERED", counterKobo, expiresAt: hoursAfter(now, OFFER_TTL_HOURS), decidedByUserId: actor.userId },
        { actorId: actor.userId, action: "offer.counter", meta: { offerId: row.id, counterKobo } },
        "OFFER_NOT_OPEN",
        now,
      );
      await tellBuyer(tx, "OFFER_COUNTERED", row, actor.userId);
    }
  });
  if (note) await postToBuyerThread(actor, row.lotId, row.buyerUserId, note, now);
  return officerViewOf((await loadCooperativeOffer(row.id)) as CooperativeOfferRow, now);
}

// The farmer agrees to, or declines, a below-floor offer an officer referred to them.
export async function farmerRespondToOffer(
  actor: Actor,
  offerId: string,
  agree: boolean,
  now: Date = new Date(),
): Promise<FarmerOffer> {
  const row = await loadCooperativeOffer(offerId);
  if (!row || !can(actor, "lot:own", { cooperativeId: row.cooperativeId, ownerUserId: row.lot.farmerUserId })) {
    throw new NotFoundError("OFFER_NOT_FOUND");
  }
  if (row.status !== "AWAITING_FARMER") {
    throw new ConflictError("Offer is not waiting for you", "OFFER_NOT_AWAITING_FARMER");
  }
  assertNotExpired(row.expiresAt, now);
  if (!isPubliclyVisible(row.lot, now)) throw notAvailable();
  await prisma.$transaction(async (tx) => {
    if (agree) {
      await accept(tx, row, "AWAITING_FARMER", row.offeredKobo, actor.userId, "offer.farmer_agree", now);
      await tellBuyer(tx, "OFFER_ACCEPTED", row, actor.userId);
    } else {
      await move(
        tx,
        row,
        "AWAITING_FARMER",
        { status: "REJECTED", decidedByUserId: actor.userId, decidedAt: now },
        { actorId: actor.userId, action: "offer.farmer_decline", meta: { offerId: row.id } },
        "OFFER_NOT_AWAITING_FARMER",
        now,
      );
      await tellBuyer(tx, "OFFER_DECLINED", row, actor.userId);
    }
    await tellOfficers(tx, "OFFER_FARMER_ANSWERED", row, actor.userId);
  });
  return farmerViewOf((await loadCooperativeOffer(row.id)) as CooperativeOfferRow, now);
}

// The buyer accepts the cooperative's counter (at the counter price) or declines it, which
// withdraws the offer.
export async function respondToCounter(
  actor: Actor,
  offerId: string,
  accepted: boolean,
  now: Date = new Date(),
): Promise<BuyerOffer> {
  const offer = await loadOwnOffer(actor, offerId);
  if (offer.status !== "COUNTERED") throw new ConflictError("No counter to answer", "OFFER_NOT_COUNTERED");
  assertNotExpired(offer.expiresAt, now);
  if (!isPubliclyVisible(offer.lot, now)) throw notAvailable();
  await prisma.$transaction(async (tx) => {
    if (accepted) {
      await accept(tx, offer, "COUNTERED", offer.counterKobo as number, actor.userId, "offer.counter_accept", now);
    } else {
      await move(
        tx,
        offer,
        "COUNTERED",
        { status: "WITHDRAWN", decidedAt: now },
        { actorId: actor.userId, action: "offer.counter_decline", meta: { offerId: offer.id } },
        "OFFER_NOT_COUNTERED",
        now,
      );
    }
    await tellOfficers(tx, "OFFER_COUNTER_ANSWERED", offer, actor.userId);
  });
  return buyerViewOf(await loadOwnOffer(actor, offerId), now);
}

export async function withdrawOffer(actor: Actor, offerId: string, now: Date = new Date()): Promise<BuyerOffer> {
  const offer = await loadOwnOffer(actor, offerId);
  if (!(LIVE_OFFER as readonly OfferStatus[]).includes(offer.status)) {
    throw new ConflictError("Offer is no longer live", "OFFER_NOT_LIVE");
  }
  assertNotExpired(offer.expiresAt, now);
  if (!isPubliclyVisible(offer.lot, now)) throw notAvailable();
  await prisma.$transaction(async (tx) => {
    await move(
      tx,
      offer,
      LIVE_OFFER,
      { status: "WITHDRAWN", decidedAt: now },
      { actorId: actor.userId, action: "offer.withdraw", meta: { offerId: offer.id } },
      "OFFER_NOT_LIVE",
      now,
    );
    await tellOfficers(tx, "OFFER_WITHDRAWN", offer, actor.userId);
  });
  return buyerViewOf(await loadOwnOffer(actor, offerId), now);
}

// The cooperative's offers: live ones first (oldest first), then the 30 most recently decided.
export async function listCooperativeOffers(actor: Actor, now: Date = new Date()): Promise<OfficerOffer[]> {
  if (!actor.cooperativeId || !can(actor, "offer:respond", { cooperativeId: actor.cooperativeId })) {
    throw new ForbiddenError();
  }
  const cooperativeId = actor.cooperativeId;
  const [live, decided] = await Promise.all([
    prisma.offer.findMany({
      where: { cooperativeId, status: { in: [...LIVE_OFFER] } },
      include: COOPERATIVE_OFFER,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 200,
    }),
    prisma.offer.findMany({
      where: { cooperativeId, status: { notIn: [...LIVE_OFFER] } },
      include: COOPERATIVE_OFFER,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 30,
    }),
  ]);
  return [...live, ...decided].map((row) => officerViewOf(row, now));
}

export async function getCooperativeOffer(actor: Actor, offerId: string, now: Date = new Date()): Promise<OfficerOffer> {
  return officerViewOf(await loadOfferForOfficer(actor, offerId), now);
}

// Below-floor offers on the farmer's own live lots that are waiting for their answer.
export async function listOffersAwaitingFarmer(actor: Actor, now: Date = new Date()): Promise<FarmerOffer[]> {
  if (!actor.cooperativeId || !can(actor, "lot:own", { cooperativeId: actor.cooperativeId, ownerUserId: actor.userId })) {
    throw new ForbiddenError();
  }
  const rows = await prisma.offer.findMany({
    where: {
      cooperativeId: actor.cooperativeId,
      status: "AWAITING_FARMER",
      expiresAt: { gt: now },
      lot: { farmerUserId: actor.userId },
    },
    include: COOPERATIVE_OFFER,
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
  });
  return rows.filter((row) => isPubliclyVisible(row.lot, now)).map((row) => farmerViewOf(row, now));
}

