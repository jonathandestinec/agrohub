import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { TILE_ITEMS, type Summary } from "@/lib/summary";
import { can, type Actor } from "@/modules/identity/policies";
import { toNameChangeTileItem } from "./views";

// Name changes waiting for an admin, as listNameChangeQueue reads them, oldest first. Only the
// name asked for and the date: no reason, document or requester.
export async function nameChangeQueueSummary(actor: Actor): Promise<Summary> {
  if (!can(actor, "name:queue")) throw new ForbiddenError();
  const where = { status: "PENDING" as const };
  const [count, rows] = await Promise.all([
    prisma.nameChangeRequest.count({ where }),
    prisma.nameChangeRequest.findMany({
      where,
      select: { id: true, toName: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: TILE_ITEMS,
    }),
  ]);
  return { count, items: rows.map(toNameChangeTileItem) };
}
