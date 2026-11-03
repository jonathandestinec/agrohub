import type { Prisma } from "@/generated/prisma/client";

// Offer limits (spec 6.5 "rate limits on offers to stop spam"; spec 13 timings).
export const OFFERS_PER_HOUR = 10;
export const OFFERS_PER_LOT_PER_DAY = 5;
export const OFFER_TTL_HOURS = 48;
export const ACCEPT_HOLD_HOURS = 24;

export const HOUR_MS = 3_600_000;

export function hoursAfter(at: Date, hours: number): Date {
  return new Date(at.getTime() + hours * HOUR_MS);
}

// Quantity held on a lot by accepted offers whose 24 hours to pay have not run out.
export async function heldQuantity(tx: Prisma.TransactionClient, lotId: string, now: Date): Promise<number> {
  const held = await tx.offer.aggregate({
    where: { lotId, status: "ACCEPTED", payByAt: { gt: now } },
    _sum: { quantity: true },
  });
  return held._sum.quantity ?? 0;
}

// Locks a user's row until the transaction ends, so two requests from one person cannot both
// pass a rate-limit count.
export async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;
}
