import { prisma } from "@/lib/db";
import { lagosDate, lagosDateKey } from "@/lib/lagos-date";
import { recordAudit } from "@/modules/audit/audit";
import { LOT_INCLUDE, photoUrlsOf } from "./lots";
import type { Prisma } from "@/generated/prisma/client";
import type { LotFilters } from "./search-schema";
import { toPublicLot, type PublicLot } from "./views";

const PAGE_SIZE = 24;
const EXPIRABLE = ["PENDING_REVIEW", "COUNTERED", "LIVE"] as const;

// Live lots for buyers and signed-out visitors: no Actor, because browsing is public
// (spec 11) and toPublicLot carries no private field. A suspended cooperative's lots are
// hidden at once, and a lot past its available-until date is hidden before the daily job
// marks it EXPIRED.
export async function listLiveLots(now: Date = new Date()): Promise<PublicLot[]> {
  return (await searchLiveLots({ sort: "newest", page: 1 }, now)).lots;
}

// What makes a lot publicly visible. Shared by the search, the lot page and the marketplace.
export function publiclyVisibleWhere(now: Date): Prisma.LotWhereInput {
  return {
    status: "LIVE",
    cooperative: { status: "VERIFIED" },
    availableUntil: { gte: lagosDate(lagosDateKey(now)) },
  };
}

const ORDER: Record<LotFilters["sort"], Prisma.LotOrderByWithRelationInput[]> = {
  newest: [{ approvedAt: "desc" }, { id: "asc" }],
  price_asc: [{ askKobo: "asc" }, { id: "asc" }],
  price_desc: [{ askKobo: "desc" }, { id: "asc" }],
};

// Public search over live lots (no Actor: browsing is public, spec 11, and only PublicLot
// leaves). 24 a page; one extra row is read to tell whether another page exists.
export async function searchLiveLots(
  filters: LotFilters,
  now: Date = new Date(),
): Promise<{ lots: PublicLot[]; page: number; hasMore: boolean }> {
  const where: Prisma.LotWhereInput = { ...publiclyVisibleWhere(now) };
  if (filters.cropId) where.cropId = filters.cropId;
  if (filters.cooperativeId) where.cooperativeId = filters.cooperativeId;
  if (filters.state) where.pickupState = filters.state;
  if (filters.grade) where.grade = filters.grade;
  if (filters.minPriceKobo !== undefined || filters.maxPriceKobo !== undefined) {
    where.askKobo = { gte: filters.minPriceKobo, lte: filters.maxPriceKobo };
  }
  if (filters.minQuantity !== undefined) where.quantity = { gte: filters.minQuantity };
  const rows = await prisma.lot.findMany({
    where,
    include: LOT_INCLUDE,
    orderBy: ORDER[filters.sort],
    skip: (filters.page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
  });
  const lots = await Promise.all(
    rows.slice(0, PAGE_SIZE).map(async (lot) => toPublicLot(lot, await photoUrlsOf(lot.id))),
  );
  return { lots, page: filters.page, hasMore: rows.length > PAGE_SIZE };
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
