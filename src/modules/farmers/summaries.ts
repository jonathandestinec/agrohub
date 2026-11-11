import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { TILE_ITEMS, type Summary } from "@/lib/summary";
import { can, type Actor } from "@/modules/identity/policies";
import { toPendingFarmerTileItem } from "./views";

// The cooperative's PENDING farmer memberships, as listPendingFarmers reads them (same check,
// same filter on the membership, and only those with a profile), oldest first.
export async function pendingFarmersSummary(actor: Actor): Promise<Summary> {
  const cooperativeId = actor.cooperativeId;
  if (cooperativeId === null || !can(actor, "farmer:approve", { cooperativeId })) throw new ForbiddenError();
  const where = {
    cooperativeId,
    role: "FARMER" as const,
    status: "PENDING" as const,
    user: { farmerProfile: { isNot: null } },
  };
  const [count, rows] = await Promise.all([
    prisma.membership.count({ where }),
    prisma.membership.findMany({
      where,
      select: { id: true, createdAt: true, user: { select: { name: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: TILE_ITEMS,
    }),
  ]);
  return { count, items: rows.map(toPendingFarmerTileItem) };
}
