import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { can, type Actor } from "@/modules/identity/policies";
import { buyerThreadVersion } from "@/modules/messaging/service";

// A string that changes whenever the offer page would show something different: the offer's
// updatedAt (every answer, counter, withdrawal and expiry writes it) and the buyer's thread on the
// lot, which the page shows. Same access as the pages: the buyer's own offer, or an officer of
// the offer's cooperative; anyone else gets "not found".
export async function offerVersion(actor: Actor, offerId: string): Promise<string> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { buyerUserId: true, cooperativeId: true, lotId: true, updatedAt: true },
  });
  const mayRead =
    offer !== null &&
    (actor.role === "BUYER"
      ? can(actor, "offer:own", { ownerUserId: offer.buyerUserId })
      : actor.role === "OFFICER" && can(actor, "offer:respond", { cooperativeId: offer.cooperativeId }));
  if (!offer || !mayRead) throw new NotFoundError("OFFER_NOT_FOUND");
  return `${offer.updatedAt.getTime()}|${await buyerThreadVersion(actor, offer.lotId, offer.buyerUserId)}`;
}

// A string that changes when an offer in the actor's list is added or changes: how many there are
// and the newest updatedAt, over the buyer's offers, the cooperative's, or the offers on the
// farmer's own lots (any status, so an offer that leaves the farmer's queue shows too).
export async function offersListVersion(actor: Actor): Promise<string> {
  let where: Prisma.OfferWhereInput;
  if (actor.role === "BUYER" && can(actor, "offer:own", { ownerUserId: actor.userId })) {
    where = { buyerUserId: actor.userId };
  } else if (actor.role === "OFFICER" && actor.cooperativeId && can(actor, "offer:respond", { cooperativeId: actor.cooperativeId })) {
    where = { cooperativeId: actor.cooperativeId };
  } else if (
    actor.role === "FARMER" &&
    actor.cooperativeId &&
    can(actor, "lot:own", { cooperativeId: actor.cooperativeId, ownerUserId: actor.userId })
  ) {
    where = { cooperativeId: actor.cooperativeId, lot: { farmerUserId: actor.userId } };
  } else {
    throw new ForbiddenError();
  }
  const summary = await prisma.offer.aggregate({ where, _count: { _all: true }, _max: { updatedAt: true } });
  return `${summary._count._all}:${summary._max.updatedAt?.getTime() ?? 0}`;
}
