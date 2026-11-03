import { z } from "zod";

// Trims and collapses inner whitespace, so "  Guinea   corn " is stored as "Guinea corn".
export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

// The uniqueness key: the normalized name lower-cased.
export function nameKeyOf(value: string): string {
  return normalizeName(value).toLowerCase();
}

export const nameInput = z.object({
  name: z.string().transform(normalizeName).pipe(z.string().min(1).max(60)),
});

export type NameInput = { name: string };
