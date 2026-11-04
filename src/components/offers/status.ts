import type { ChipTone } from "@/components/ui";
import type { OfferStatus } from "@/generated/prisma/client";
import type { BuyerOfferStatus } from "@/modules/marketplace/service";

// Pure: the offers.* message key for what a buyer sees of an offer's status.
export function buyerStatusLabelKey(status: BuyerOfferStatus): `buyerStatus.${BuyerOfferStatus}` {
  return `buyerStatus.${status}`;
}

export const BUYER_STATUS_TONE: Record<BuyerOfferStatus, ChipTone> = {
  WAITING: "step",
  COUNTERED: "warn",
  ACCEPTED: "lime",
  DECLINED: "paper",
  EXPIRED: "paper",
  WITHDRAWN: "paper",
};

// The cooperative sees every status, AWAITING_FARMER included.
export const OFFICER_STATUS_TONE: Record<OfferStatus, ChipTone> = {
  OPEN: "warn",
  AWAITING_FARMER: "step",
  COUNTERED: "step",
  ACCEPTED: "lime",
  REJECTED: "paper",
  EXPIRED: "paper",
  WITHDRAWN: "paper",
};
