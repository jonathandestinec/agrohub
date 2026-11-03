import type { Offer, OfferStatus } from "@/generated/prisma/client";
import { lineTotalKobo } from "@/lib/money";

// What the buyer may know about an offer's state. OPEN and AWAITING_FARMER both read WAITING,
// so a buyer cannot tell that an officer found the offer below the farmer's floor; a rejection
// by the officer or by the farmer both read DECLINED.
export type BuyerOfferStatus = "WAITING" | "COUNTERED" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "WITHDRAWN";

// Pure. An offer still awaiting an answer reads EXPIRED once its time has passed or its lot is
// no longer on sale, before the daily job marks it; an accepted one once its time to pay ends.
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
      return payByAt !== null && payByAt <= now ? "EXPIRED" : "ACCEPTED";
    case "REJECTED":
      return "DECLINED";
    case "EXPIRED":
      return "EXPIRED";
    case "WITHDRAWN":
      return "WITHDRAWN";
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
