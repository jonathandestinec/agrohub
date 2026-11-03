import { z } from "zod";
import { normalizeName } from "@/modules/catalog/schema";

// ₦20,000,000 per unit: far above any board price, and inside a Postgres integer.
export const MAX_PRICE_KOBO = 2_000_000_000;

// "YYYY-MM-DD" naming a real calendar date.
export const weekInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  });

export const recordPriceInput = z.object({
  cropId: z.string().min(1),
  unitId: z.string().min(1),
  market: z.string().transform(normalizeName).pipe(z.string().min(1).max(80)),
  weekOf: weekInput,
  priceKobo: z.number().int().min(1).max(MAX_PRICE_KOBO),
});

export type RecordPriceInput = {
  cropId: string;
  unitId: string;
  market: string;
  weekOf: string;
  priceKobo: number;
};
