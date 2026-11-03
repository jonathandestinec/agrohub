import type { ChipTone } from "@/components/ui";

export type LotStatusName =
  | "PENDING_REVIEW"
  | "COUNTERED"
  | "REJECTED"
  | "LIVE"
  | "WITHDRAWN"
  | "EXPIRED"
  | "SOLD_OUT";

// Chip tone per lot status; labels live in messages under lots.status.
export const LOT_STATUS_TONE: Record<LotStatusName, ChipTone> = {
  PENDING_REVIEW: "warn",
  COUNTERED: "warn",
  REJECTED: "paper",
  LIVE: "forest",
  WITHDRAWN: "paper",
  EXPIRED: "paper",
  SOLD_OUT: "step",
};
