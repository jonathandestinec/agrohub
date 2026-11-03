import type { CooperativeStatus, LotStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { lagosDate, lagosDateKey } from "@/lib/lagos-date";
import type { LotTerms } from "./views";

// What the marketplace and messaging services need to negotiate over a lot. It carries the
// private floor, so it is for server code only: nothing may return it to a client, and the
// buyer-facing views in marketplace/views.ts and messaging/views.ts never read floorKobo.
export type NegotiationFacts = {
  id: string;
  cooperativeId: string;
  cooperativeName: string;
  farmerUserId: string;
  crop: string;
  unit: string;
  askKobo: number;
  floorKobo: number;
  quantity: number;
  minOrderQty: number;
  feeTerms: LotTerms | null;
  publiclyVisible: boolean;
};

// Pure: the rule behind publiclyVisibleWhere (public.ts), for a lot already loaded.
export function isPubliclyVisible(
  lot: { status: LotStatus; availableUntil: Date; cooperative: { status: CooperativeStatus } },
  now: Date,
): boolean {
  return (
    lot.status === "LIVE" &&
    lot.cooperative.status === "VERIFIED" &&
    lot.availableUntil.getTime() >= lagosDate(lagosDateKey(now)).getTime()
  );
}

// Server-internal read with no Actor: callers (marketplace and messaging services) check their
// own permissions first. A missing lot is NotFoundError LOT_NOT_FOUND.
export async function lotNegotiationFacts(
  lotId: string,
  now: Date = new Date(),
  client: Prisma.TransactionClient = prisma,
): Promise<NegotiationFacts> {
  const lot = await client.lot.findUnique({
    where: { id: lotId },
    include: {
      crop: { select: { name: true } },
      unit: { select: { name: true } },
      cooperative: { select: { name: true, status: true } },
      feeTerms: true,
    },
  });
  if (!lot) throw new NotFoundError("LOT_NOT_FOUND");
  return {
    id: lot.id,
    cooperativeId: lot.cooperativeId,
    cooperativeName: lot.cooperative.name,
    farmerUserId: lot.farmerUserId,
    crop: lot.crop.name,
    unit: lot.unit.name,
    askKobo: lot.askKobo,
    floorKobo: lot.floorKobo,
    quantity: lot.quantity,
    minOrderQty: lot.minOrderQty,
    feeTerms: lot.feeTerms
      ? { cooperativeCutBps: lot.feeTerms.cooperativeCutBps, platformFeeBps: lot.feeTerms.platformFeeBps }
      : null,
    publiclyVisible: isPubliclyVisible(lot, now),
  };
}

// Locks the lot's row until the transaction ends, so acceptances on one lot run one at a time.
export async function lockLot(tx: Prisma.TransactionClient, lotId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "lot" WHERE id = ${lotId} FOR UPDATE`;
}
