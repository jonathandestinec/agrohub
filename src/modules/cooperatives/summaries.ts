import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { TILE_ITEMS, type Summary } from "@/lib/summary";
import { can, type Actor } from "@/modules/identity/policies";
import { toVerificationTileItem } from "./views";

// Cooperatives that submitted for verification and wait for an admin, as listVerificationQueue
// reads them (same check and filter), longest-waiting first.
export async function verificationSummary(actor: Actor): Promise<Summary> {
  if (!can(actor, "cooperative:queue")) throw new ForbiddenError();
  const where = { status: "PENDING" as const, submittedAt: { not: null } };
  const [count, rows] = await Promise.all([
    prisma.cooperative.count({ where }),
    prisma.cooperative.findMany({
      where,
      select: { id: true, name: true, submittedAt: true },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      take: TILE_ITEMS,
    }),
  ]);
  return { count, items: rows.map(toVerificationTileItem) };
}
