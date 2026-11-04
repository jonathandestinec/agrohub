import type { Offer, OfferStatus } from "@/generated/prisma/client";
import { lineTotalKobo, type SaleBreakdown } from "@/lib/money";

// What the buyer may know about an offer's state. OPEN and AWAITING_FARMER both read WAITING,
// so a buyer cannot tell that an officer found the offer below the farmer's floor; a rejection
// by the officer or by the farmer both read DECLINED.
// ORDERED: the accepted offer's order was paid (Phase 5).
export type BuyerOfferStatus = "WAITING" | "COUNTERED" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "WITHDRAWN" | "ORDERED";

// Pure. An offer reads EXPIRED once its time (to answer, or to pay once accepted) has passed or
// its lot is no longer on sale, before the daily job marks it. Phase 5's checkout must take only
// offers whose status reads ACCEPTED here.
export function buyerStatusOf(
  status: OfferStatus,
  expiresAt: Date,
  payByAt: Date | null,
  lotVisible: boolean,
  now: Date,
): BuyerOfferStatus {
  switch (status) {
    case "OPEN":
    case "AWAITING_FARMER":
      return expiresAt <= now || !lotVisible ? "EXPIRED" : "WAITING";
    case "COUNTERED":
      return expiresAt <= now || !lotVisible ? "EXPIRED" : "COUNTERED";
    case "ACCEPTED":
      return (payByAt !== null && payByAt <= now) || !lotVisible ? "EXPIRED" : "ACCEPTED";
    case "REJECTED":
      return "DECLINED";
    case "EXPIRED":
      return "EXPIRED";
    case "WITHDRAWN":
      return "WITHDRAWN";
    case "ORDERED":
      return "ORDERED";
  }
}

// The lot fields every offer view shows; never the floor or the farmer.
export type OfferLotSummary = { id: string; crop: string; unit: string; cooperativeName: string };

export type BuyerOffer = {
  id: string;
  lot: OfferLotSummary;
  quantity: number;
  offeredKobo: number;
  counterKobo: number | null;
  agreedKobo: number | null;
  totalKobo: number;
  status: BuyerOfferStatus;
  expiresAt: string;
  payByAt: string | null;
  createdAt: string;
};

// The price the offer currently stands at: agreed, else countered, else offered.
export function currentUnitKobo(offer: Pick<Offer, "offeredKobo" | "counterKobo" | "agreedKobo">): number {
  return offer.agreedKobo ?? offer.counterKobo ?? offer.offeredKobo;
}

// Built field by field: Offer rows hold who referred or decided the offer, which buyers never see.
export function toBuyerOffer(offer: Offer, lot: OfferLotSummary, lotVisible: boolean, now: Date): BuyerOffer {
  return {
    id: offer.id,
    lot: { id: lot.id, crop: lot.crop, unit: lot.unit, cooperativeName: lot.cooperativeName },
    quantity: offer.quantity,
    offeredKobo: offer.offeredKobo,
    counterKobo: offer.counterKobo,
    agreedKobo: offer.agreedKobo,
    totalKobo: lineTotalKobo(currentUnitKobo(offer), offer.quantity),
    status: buyerStatusOf(offer.status, offer.expiresAt, offer.payByAt, lotVisible, now),
    expiresAt: offer.expiresAt.toISOString(),
    payByAt: offer.payByAt?.toISOString() ?? null,
    createdAt: offer.createdAt.toISOString(),
  };
}

// Pure: the status officers and farmers see. An offer still waiting, or accepted and not yet
// paid, reads EXPIRED once its time has passed or its lot is off sale, before the job runs.
export function effectiveStatus(
  status: OfferStatus,
  expiresAt: Date,
  payByAt: Date | null,
  lotVisible: boolean,
  now: Date,
): OfferStatus {
  if ((status === "OPEN" || status === "AWAITING_FARMER" || status === "COUNTERED") && (expiresAt <= now || !lotVisible)) {
    return "EXPIRED";
  }
  if (status === "ACCEPTED" && ((payByAt !== null && payByAt <= now) || !lotVisible)) return "EXPIRED";
  return status;
}

// The cooperative's view: the officer negotiates for the cooperative, so it sees the floor and
// the buyer's name, never the buyer's email or phone.
export type OfficerOffer = {
  id: string;
  lotId: string;
  crop: string;
  unit: string;
  buyerUserId: string;
  buyerName: string;
  quantity: number;
  offeredKobo: number;
  counterKobo: number | null;
  agreedKobo: number | null;
  askKobo: number;
  floorKobo: number;
  belowFloor: boolean;
  status: OfferStatus;
  expiresAt: string;
  payByAt: string | null;
  createdAt: string;
};

export function toOfficerOffer(
  offer: Offer,
  lot: { crop: string; unit: string; askKobo: number; floorKobo: number },
  buyerName: string,
  lotVisible: boolean,
  now: Date,
): OfficerOffer {
  return {
    id: offer.id,
    lotId: offer.lotId,
    crop: lot.crop,
    unit: lot.unit,
    buyerUserId: offer.buyerUserId,
    buyerName,
    quantity: offer.quantity,
    offeredKobo: offer.offeredKobo,
    counterKobo: offer.counterKobo,
    agreedKobo: offer.agreedKobo,
    askKobo: lot.askKobo,
    floorKobo: lot.floorKobo,
    belowFloor: offer.offeredKobo < lot.floorKobo,
    status: effectiveStatus(offer.status, offer.expiresAt, offer.payByAt, lotVisible, now),
    expiresAt: offer.expiresAt.toISOString(),
    payByAt: offer.payByAt?.toISOString() ?? null,
    createdAt: offer.createdAt.toISOString(),
  };
}

// The farmer's view of an offer referred to them: what they would take home, and no buyer
// identity (spec 6.9: buyer identities are never shown to farmers).
export type FarmerOffer = {
  id: string;
  lotId: string;
  crop: string;
  unit: string;
  quantity: number;
  offeredKobo: number;
  breakdown: SaleBreakdown;
  status: OfferStatus;
  expiresAt: string;
};

export function toFarmerOffer(
  offer: Offer,
  lot: { crop: string; unit: string },
  breakdown: SaleBreakdown,
  lotVisible: boolean,
  now: Date,
): FarmerOffer {
  return {
    id: offer.id,
    lotId: offer.lotId,
    crop: lot.crop,
    unit: lot.unit,
    quantity: offer.quantity,
    offeredKobo: offer.offeredKobo,
    breakdown,
    status: effectiveStatus(offer.status, offer.expiresAt, offer.payByAt, lotVisible, now),
    expiresAt: offer.expiresAt.toISOString(),
  };
}
