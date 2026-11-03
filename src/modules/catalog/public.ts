import { prisma } from "@/lib/db";
import { lagosDate, lagosDateKey } from "@/lib/lagos-date";
import { recordAudit } from "@/modules/audit/audit";
import { LOT_INCLUDE, photoUrlsOf } from "./lots";
import { toPublicLot, type PublicLot } from "./views";

const PUBLIC_LIMIT = 50;
const EXPIRABLE = ["PENDING_REVIEW", "COUNTERED", "LIVE"] as const;

// Live lots for buyers and signed-out visitors: no Actor, because browsing is public
// (spec 11) and toPublicLot carries no private field. A suspended cooperative's lots are
// hidden at once, and a lot past its available-until date is hidden before the daily job
// marks it EXPIRED.
export async function listLiveLots(now: Date = new Date()): Promise<PublicLot[]> {
  const lots = await prisma.lot.findMany({
    where: {
      status: "LIVE",
      cooperative: { status: "VERIFIED" },
      availableUntil: { gte: lagosDate(lagosDateKey(now)) },
    },
    include: LOT_INCLUDE,
    orderBy: [{ approvedAt: "desc" }, { id: "asc" }],
    take: PUBLIC_LIMIT,
  });
  return Promise.all(lots.map(async (lot) => toPublicLot(lot, await photoUrlsOf(lot.id))));
}

// The daily lot-expiry job: lots still open after their available-until date (a Lagos day)
// become EXPIRED, and any pending change is superseded. Safe to run twice: a lot already
// expired matches nothing. Returns how many lots it expired.
export async function expireLots(now: Date = new Date()): Promise<number> {
  const today = lagosDate(lagosDateKey(now));
  const due = await prisma.lot.findMany({
    where: { status: { in: [...EXPIRABLE] }, availableUntil: { lt: today } },
    select: { id: true, status: true, cooperativeId: true },
  });
  let expired = 0;
  for (const lot of due) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.lot.updateMany({
        where: { id: lot.id, status: { in: [...EXPIRABLE] }, availableUntil: { lt: today } },
        data: { status: "EXPIRED", counterAskKobo: null, counterMessage: null },
      });
      if (count === 0) return;
      expired += 1;
      await tx.lotRevision.updateMany({
        where: { lotId: lot.id, status: "PENDING" },
        data: { status: "SUPERSEDED", decidedAt: now },
      });
      await recordAudit(
        {
          actorId: null,
          action: "lot.expire",
          entity: "lot",
          entityId: lot.id,
          meta: { lotId: lot.id, cooperativeId: lot.cooperativeId, fromStatus: lot.status },
        },
        tx,
      );
    });
  }
  return expired;
}
