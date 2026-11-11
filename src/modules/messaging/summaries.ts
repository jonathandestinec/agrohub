import { prisma } from "@/lib/db";
import { TILE_ITEMS, type History } from "@/lib/summary";
import { ForbiddenError } from "@/lib/errors";
import { can, type Actor } from "@/modules/identity/policies";
import { toThreadTileItem } from "./views";
import { threadWhereFor } from "./where";

// The actor's three most recently active threads (the same threads listOwnThreads reads;
// threadWhereFor throws ForbiddenError for the roles that have none). No message text.
export async function latestThreads(actor: Actor): Promise<History> {
  // Only the roles with a home page read this; threadWhereFor then scopes to their own threads.
  if (!can(actor, "home:view")) throw new ForbiddenError();
  const threads = await prisma.thread.findMany({
    where: threadWhereFor(actor),
    select: {
      id: true,
      lastMessageAt: true,
      cooperative: { select: { name: true } },
      counterpart: { select: { name: true } },
      lot: { select: { crop: { select: { name: true } } } },
    },
    orderBy: [{ lastMessageAt: "desc" }, { id: "asc" }],
    take: TILE_ITEMS,
  });
  return { items: threads.map((thread) => toThreadTileItem(thread, actor)) };
}
