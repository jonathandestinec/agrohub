import { z } from "zod";
import { STATES } from "@/modules/geo/states";

export const LOT_GRADES = ["A", "B", "C", "UNGRADED"] as const;
export const MAX_QUANTITY = 1_000_000;
// ₦20,000,000 per unit; ask × quantity stays inside the safe integer range.
export const MAX_PRICE_KOBO = 2_000_000_000;
export const NOTE_MIN_WHEN_WARNED = 10;
export const MAX_AVAILABLE_DAYS = 90;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const kobo = z.number().int().min(1).max(MAX_PRICE_KOBO);
const quantity = z.number().int().min(1).max(MAX_QUANTITY);

export const submitLotInput = z.object({
  cropId: z.string().min(1).max(64),
  unitId: z.string().min(1).max(64),
  quantity,
  grade: z.enum(LOT_GRADES),
  pickupState: z.enum(STATES),
  pickupLga: z.string().trim().min(1).max(80),
  pickupNote: text(120),
  askKobo: kobo,
  floorKobo: kobo,
  note: text(500),
  availableUntil: z.string(),
});

// State and grade are plain strings at the boundary; the schema narrows them.
export type SubmitLotInput = {
  cropId: string;
  unitId: string;
  quantity: number;
  grade: string;
  pickupState: string;
  pickupLga: string;
  pickupNote?: string;
  askKobo: number;
  floorKobo: number;
  note?: string;
  availableUntil: string;
};

// A live lot's price or quantity change, which goes to the officer as a revision.
export const revisionInput = z.object({
  askKobo: kobo,
  quantity,
  floorKobo: kobo,
  note: text(500),
});

export type RevisionInput = { askKobo: number; quantity: number; floorKobo: number; note?: string };
