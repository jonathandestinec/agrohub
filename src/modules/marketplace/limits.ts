import type { Prisma } from "@/generated/prisma/client";

// Offer limits (spec 6.5 "rate limits on offers to stop spam"; spec 13 timings).
export const OFFERS_PER_HOUR = 10;
export const OFFERS_PER_LOT_PER_DAY = 5;
export const OFFER_TTL_HOURS = 48;
export const ACCEPT_HOLD_HOURS = 24;
// An officer may send a below-floor offer to the farmer only while this much of its 48 hours is
// left, so the farmer has time to answer. Later, the officer rejects or counters instead.
export const REFERRAL_MIN_HOURS = 12;

export const HOUR_MS = 3_600_000;

export function hoursAfter(at: Date, hours: number): Date {
  return new Date(at.getTime() + hours * HOUR_MS);
}

// Locks a user's row until the transaction ends, so two requests from one person cannot both
// pass a rate-limit count.
export async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;
}
