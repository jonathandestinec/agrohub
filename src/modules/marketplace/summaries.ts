import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { TILE_ITEMS, type Summary } from "@/lib/summary";
import { publiclyVisibleWhere } from "@/modules/catalog/service";
import { can, type Actor } from "@/modules/identity/policies";
import { buyerStatusOf, toOfferTileItem } from "./views";

const OFFER_TILE = {
  id: true,
  lotId: true,
  quantity: true,
  expiresAt: true,
  lot: { select: { crop: { select: { name: true } }, unit: { select: { name: true } } } },
} as const;

// Below-floor offers on the farmer's own live lots that wait for their answer: the same
// filter and check as listOffersAwaitingFarmer, without its row cap. Oldest deadline first.
export async function farmerOffersSummary(actor: Actor, now: Date = new Date()): Promise<Summary> {
  if (!actor.cooperativeId || !can(actor, "lot:own", { cooperativeId: actor.cooperativeId, ownerUserId: actor.userId })) {
    throw new ForbiddenError();
  }
  const where = {
    cooperativeId: actor.cooperativeId,
    status: "AWAITING_FARMER" as const,
    expiresAt: { gt: now },
    lot: { farmerUserId: actor.userId, ...publiclyVisibleWhere(now) },
  };
  const [count, rows] = await Promise.all([
    prisma.offer.count({ where }),
    prisma.offer.findMany({
      where,
      select: OFFER_TILE,
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: TILE_ITEMS,
    }),
  ]);
  return { count, items: rows.map((row) => toOfferTileItem(row, `/farmer/lots/${row.lotId}`, { date: row.expiresAt })) };
}

// The buyer's offers that need them: accepted and still inside the time to pay (pay now), or
// countered and still open (answer the counter). An offer whose lot is off sale reads expired
// on its own page, so it is left out here too. Oldest first; an accepted one shows its pay-by date.
export async function buyerOffersToActSummary(actor: Actor, now: Date = new Date()): Promise<Summary> {
  if (!can(actor, "offer:own", { ownerUserId: actor.userId })) throw new ForbiddenError();
  const where = {
    buyerUserId: actor.userId,
    lot: publiclyVisibleWhere(now),
    OR: [
      { status: "ACCEPTED" as const, payByAt: { gt: now } },
      { status: "COUNTERED" as const, expiresAt: { gt: now } },
    ],
  };
  const [count, rows] = await Promise.all([
    prisma.offer.count({ where }),
    prisma.offer.findMany({
      where,
      select: { ...OFFER_TILE, status: true, payByAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: TILE_ITEMS,
    }),
  ]);
  return {
    count,
    items: rows.map((row) =>
      toOfferTileItem(row, `/buyer/offers/${row.id}`, {
        date: row.status === "ACCEPTED" ? row.payByAt : null,
        label: `offers.buyerStatus.${buyerStatusOf(row.status, row.expiresAt, row.payByAt, true, now)}`,
      }),
    ),
  };
}

// The cooperative's offers waiting for an officer: OPEN and not yet expired, oldest first.
export async function officerOffersSummary(actor: Actor, now: Date = new Date()): Promise<Summary> {
  if (!actor.cooperativeId || !can(actor, "offer:respond", { cooperativeId: actor.cooperativeId })) {
    throw new ForbiddenError();
  }
  const where = { cooperativeId: actor.cooperativeId, status: "OPEN" as const, expiresAt: { gt: now } };
  const [count, rows] = await Promise.all([
    prisma.offer.count({ where }),
    prisma.offer.findMany({ where, select: OFFER_TILE, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: TILE_ITEMS }),
  ]);
  return { count, items: rows.map((row) => toOfferTileItem(row, `/officer/offers/${row.id}`, { date: row.expiresAt })) };
}
