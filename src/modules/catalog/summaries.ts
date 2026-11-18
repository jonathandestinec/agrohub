import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { TILE_ITEMS, type Summary } from "@/lib/summary";
import { can, type Actor } from "@/modules/identity/policies";
import { otherOfficerExists } from "./screening";
import { toCatalogRequestTileItem, toLotTileItem } from "./views";

function assertOwnLots(actor: Actor): string {
  const cooperativeId = actor.cooperativeId;
  if (cooperativeId === null || !can(actor, "lot:own", { cooperativeId, ownerUserId: actor.userId })) {
    throw new ForbiddenError();
  }
  return cooperativeId;
}

// The farmer's own lots that an officer countered and that wait for the farmer's answer.
export async function farmerCounteredLotsSummary(actor: Actor): Promise<Summary> {
  const cooperativeId = assertOwnLots(actor);
  const where = { farmerUserId: actor.userId, cooperativeId, status: "COUNTERED" as const };
  const [count, rows] = await Promise.all([
    prisma.lot.count({ where }),
    prisma.lot.findMany({
      where,
      select: { id: true, quantity: true, crop: { select: { name: true } }, unit: { select: { name: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: TILE_ITEMS,
    }),
  ]);
  return { count, items: rows.map((row) => toLotTileItem(row, `/farmer/lots/${row.id}`)) };
}

export type FarmerLotCounts = { pendingReview: number; live: number; soldOut: number };

// The farmer's own lots by status, in one grouped read. Three numbers, no items.
export async function farmerLotCounts(actor: Actor): Promise<FarmerLotCounts> {
  const cooperativeId = assertOwnLots(actor);
  const groups = await prisma.lot.groupBy({
    by: ["status"],
    where: { farmerUserId: actor.userId, cooperativeId, status: { in: ["PENDING_REVIEW", "LIVE", "SOLD_OUT"] } },
    _count: { _all: true },
  });
  const of = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
  return { pendingReview: of("PENDING_REVIEW"), live: of("LIVE"), soldOut: of("SOLD_OUT") };
}

const LOT_TILE = {
  id: true,
  quantity: true,
  cooperativeId: true,
  farmerUserId: true,
  crop: { select: { name: true } },
  unit: { select: { name: true } },
} as const;

// The lots waiting on a screener, as listScreeningQueue reads them. An officer sees their
// cooperative's PENDING_REVIEW and COUNTERED lots and live lots with a pending revision; an admin
// sees PENDING_REVIEW lots and live lots with a pending revision of cooperatives where no other
// officer can screen. Oldest first.
export async function screeningSummary(actor: Actor): Promise<Summary> {
  if (!can(actor, "lot:screen", { cooperativeId: actor.cooperativeId ?? undefined })) throw new ForbiddenError();
  if (actor.role === "OFFICER") {
    const where = {
      cooperativeId: actor.cooperativeId as string,
      OR: [
        { status: { in: ["PENDING_REVIEW", "COUNTERED"] as ("PENDING_REVIEW" | "COUNTERED")[] } },
        { status: "LIVE" as const, revisions: { some: { status: "PENDING" as const } } },
      ],
    };
    const [count, rows] = await Promise.all([
      prisma.lot.count({ where }),
      prisma.lot.findMany({ where, select: LOT_TILE, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: TILE_ITEMS }),
    ]);
    return { count, items: rows.map((row) => toLotTileItem(row, `/officer/lots/${row.id}`)) };
  }
  // Admin: whether another officer exists is a per-cooperative fact, so read the light rows
  // (ids only) and filter, as the list does; only three are then loaded in full.
  const pending = await prisma.lot.findMany({
    where: { OR: [{ status: "PENDING_REVIEW" }, { status: "LIVE", revisions: { some: { status: "PENDING" } } }] },
    select: LOT_TILE,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const needsAdmin: typeof pending = [];
  for (const lot of pending) {
    if (!(await otherOfficerExists(lot.cooperativeId, lot.farmerUserId))) needsAdmin.push(lot);
  }
  return {
    count: needsAdmin.length,
    items: needsAdmin.slice(0, TILE_ITEMS).map((row) => toLotTileItem(row, `/admin/lots/${row.id}`)),
  };
}

// The crop and unit requests with the officer, as listCooperativeCatalogRequests reads them.
export async function catalogRequestsSummary(actor: Actor): Promise<Summary> {
  const cooperativeId = actor.cooperativeId;
  if (cooperativeId === null || !can(actor, "catalog:forward", { cooperativeId })) throw new ForbiddenError();
  const where = { cooperativeId, status: "WITH_OFFICER" as const };
  const [count, rows] = await Promise.all([
    prisma.catalogRequest.count({ where }),
    prisma.catalogRequest.findMany({
      where,
      select: { id: true, name: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: TILE_ITEMS,
    }),
  ]);
  return { count, items: rows.map(toCatalogRequestTileItem) };
}
