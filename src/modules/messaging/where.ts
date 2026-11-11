import type { Prisma } from "@/generated/prisma/client";
import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "@/modules/identity/policies";

// Which threads an actor takes part in: a buyer's or farmer's own, an officer's cooperative's, or
// (for an admin) any. Shared by the thread list and the home page's latest threads.
export function threadWhereFor(actor: Actor): Prisma.ThreadWhereInput {
  if (actor.role === "BUYER") return { kind: "BUYER_COOPERATIVE", counterpartUserId: actor.userId };
  if (actor.role === "FARMER" && actor.cooperativeId) {
    return { kind: "FARMER_COOPERATIVE", counterpartUserId: actor.userId, cooperativeId: actor.cooperativeId };
  }
  if (actor.role === "OFFICER" && actor.cooperativeId) return { cooperativeId: actor.cooperativeId };
  if (actor.role === "ADMIN") return {};
  throw new ForbiddenError();
}
