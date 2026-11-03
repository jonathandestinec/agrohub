import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/audit";
import { boardReference, type BoardPrice } from "@/modules/board/service";
import { can, type Actor } from "@/modules/identity/policies";
import { MAX_PRICE_KOBO } from "./lot-schema";
import { LOT_INCLUDE, loadLot, loadOwnLot, photoUrlsOf } from "./lots";
import { toFarmerLot, toOfficerLot, type FarmerLot, type LotRow, type OfficerLot } from "./views";

const REASON_MIN = 3;
const REASON_MAX = 500;

export type ScreeningLot = OfficerLot & { canApprove: boolean };

// True when an ACTIVE officer other than the lot's owner exists in the cooperative. When
// none does (a one-person cooperative, or the only officer is the farmer), an admin screens.
export async function otherOfficerExists(cooperativeId: string, ownerUserId: string): Promise<boolean> {
  const count = await prisma.membership.count({
    where: { cooperativeId, role: "OFFICER", status: "ACTIVE", userId: { not: ownerUserId } },
  });
  return count > 0;
}

async function mayScreen(actor: Actor, lot: LotRow): Promise<boolean> {
  return can(actor, "lot:approve", {
    cooperativeId: lot.cooperativeId,
    ownerUserId: lot.farmerUserId,
    cooperativeHasOtherOfficer: await otherOfficerExists(lot.cooperativeId, lot.farmerUserId),
  });
}

// The self-approval rule (spec 3): an officer never screens their own lot; an admin only
// when no other officer can. The owner gets a code of their own so the screen can say why.
export async function assertMayScreen(actor: Actor, lot: LotRow): Promise<void> {
  if (actor.userId === lot.farmerUserId) throw new ForbiddenError("CANNOT_APPROVE_OWN_LOT");
  if (!(await mayScreen(actor, lot))) throw new ForbiddenError();
}

function parseReason(reason: unknown): string {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length < REASON_MIN || text.length > REASON_MAX) {
    throw new ValidationError("A reason is required", "REASON_REQUIRED");
  }
  return text;
}

// Moves a lot out of one status inside a transaction; a concurrent decision that got there
// first leaves count 0, so only one of two officers ever wins.
async function transition(
  tx: Prisma.TransactionClient,
  lotId: string,
  from: "PENDING_REVIEW" | "COUNTERED",
  data: Prisma.LotUpdateManyMutationInput,
): Promise<void> {
  const { count } = await tx.lot.updateMany({ where: { id: lotId, status: from }, data });
  if (count === 0) {
    throw from === "PENDING_REVIEW"
      ? new ConflictError("Lot is not waiting for screening", "LOT_NOT_PENDING")
      : new ConflictError("Lot has no open counter offer", "LOT_NOT_COUNTERED");
  }
}

// Locks the terms the farmer was quoted into LotFeeTerms. Later cut or fee changes apply only
// to new lots (spec 6.3).
async function lockTerms(tx: Prisma.TransactionClient, lot: LotRow, now: Date): Promise<void> {
  await tx.lotFeeTerms.create({
    data: {
      lotId: lot.id,
      cooperativeCutBps: lot.quotedCutBps,
      platformFeeBps: lot.quotedFeeBps,
      lockedAt: now,
    },
  });
}

async function audit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: string,
  lot: LotRow,
  meta: Record<string, unknown> = {},
): Promise<void> {
  // Ids, kobo and statuses only: never the floor, never a free-text reason.
  await recordAudit(
    {
      actorId: actor.userId,
      action: `lot.${action}`,
      entity: "lot",
      entityId: lot.id,
      meta: { lotId: lot.id, cooperativeId: lot.cooperativeId, ...meta },
    },
    tx,
  );
}

async function officerView(lotId: string): Promise<OfficerLot> {
  const lot = await loadLot(lotId);
  return toOfficerLot(lot, await photoUrlsOf(lot.id));
}

export async function approveLot(
  actor: Actor,
  lotId: string,
  input: { minOrderQty: number },
  now: Date = new Date(),
): Promise<OfficerLot> {
  const lot = await loadLot(lotId);
  await assertMayScreen(actor, lot);
  const minOrderQty = input?.minOrderQty;
  if (!Number.isSafeInteger(minOrderQty) || minOrderQty < 1 || minOrderQty > lot.quantity) {
    throw new ValidationError("Minimum order out of range", "INVALID_MIN_ORDER");
  }
  await prisma.$transaction(async (tx) => {
    await transition(tx, lot.id, "PENDING_REVIEW", {
      status: "LIVE",
      approvedAt: now,
      screenedByUserId: actor.userId,
      minOrderQty,
    });
    await lockTerms(tx, lot, now);
    await audit(tx, actor, "approve", lot, {
      cooperativeCutBps: lot.quotedCutBps,
      platformFeeBps: lot.quotedFeeBps,
      minOrderQty,
    });
  });
  return officerView(lot.id);
}

export async function rejectLot(actor: Actor, lotId: string, input: { reason: string }): Promise<OfficerLot> {
  const lot = await loadLot(lotId);
  await assertMayScreen(actor, lot);
  const reason = parseReason(input?.reason);
  await prisma.$transaction(async (tx) => {
    await transition(tx, lot.id, "PENDING_REVIEW", {
      status: "REJECTED",
      rejectionReason: reason,
      screenedByUserId: actor.userId,
    });
    await audit(tx, actor, "reject", lot);
  });
  return officerView(lot.id);
}

export async function counterLot(
  actor: Actor,
  lotId: string,
  input: { counterAskKobo: number; message?: string },
): Promise<OfficerLot> {
  const lot = await loadLot(lotId);
  await assertMayScreen(actor, lot);
  const counter = input?.counterAskKobo;
  if (!Number.isSafeInteger(counter) || counter < 1 || counter > MAX_PRICE_KOBO) {
    throw new ValidationError("Invalid price", "INVALID_PRICE");
  }
  // The officer may not push a farmer below their own lowest price; reject instead.
  if (counter < lot.floorKobo) throw new ValidationError("Below the floor", "COUNTER_BELOW_FLOOR");
  if (counter === lot.askKobo) throw new ValidationError("Same as the ask", "COUNTER_SAME_AS_ASK");
  const message = typeof input?.message === "string" ? input.message.trim().slice(0, REASON_MAX) : "";
  await prisma.$transaction(async (tx) => {
    await transition(tx, lot.id, "PENDING_REVIEW", {
      status: "COUNTERED",
      counterAskKobo: counter,
      counterMessage: message || null,
      screenedByUserId: actor.userId,
    });
    await audit(tx, actor, "counter", lot, { fromKobo: lot.askKobo, toKobo: counter });
  });
  return officerView(lot.id);
}

// The farmer answers a counter. Accepting makes the lot live at the counter price with the
// quoted terms locked (the countering officer approved it); declining withdraws the lot.
export async function respondToCounter(
  actor: Actor,
  lotId: string,
  accept: boolean,
  now: Date = new Date(),
): Promise<FarmerLot> {
  const lot = await loadOwnLot(actor, lotId);
  await prisma.$transaction(async (tx) => {
    if (accept) {
      if (lot.counterAskKobo === null) {
        throw new ConflictError("Lot has no open counter offer", "LOT_NOT_COUNTERED");
      }
      await transition(tx, lot.id, "COUNTERED", {
        status: "LIVE",
        askKobo: lot.counterAskKobo,
        approvedAt: now,
        counterAskKobo: null,
        counterMessage: null,
      });
      await lockTerms(tx, lot, now);
      await audit(tx, actor, "counter_accept", lot, {
        askKobo: lot.counterAskKobo,
        cooperativeCutBps: lot.quotedCutBps,
        platformFeeBps: lot.quotedFeeBps,
      });
    } else {
      await transition(tx, lot.id, "COUNTERED", {
        status: "WITHDRAWN",
        counterAskKobo: null,
        counterMessage: null,
      });
      await audit(tx, actor, "counter_decline", lot);
    }
  });
  const updated = await loadLot(lot.id);
  return toFarmerLot(updated, await photoUrlsOf(updated.id));
}

// ---- Queues ----

// An officer sees their cooperative's lots waiting on screening or on a counter answer, their
// own included but marked. An admin sees only PENDING_REVIEW lots that no other officer can
// screen.
export async function listScreeningQueue(actor: Actor): Promise<ScreeningLot[]> {
  if (!can(actor, "lot:screen", { cooperativeId: actor.cooperativeId ?? undefined })) {
    throw new ForbiddenError();
  }
  let lots: LotRow[];
  if (actor.role === "OFFICER") {
    lots = await prisma.lot.findMany({
      where: {
        cooperativeId: actor.cooperativeId as string,
        OR: [
          { status: { in: ["PENDING_REVIEW", "COUNTERED"] } },
          { status: "LIVE", revisions: { some: { status: "PENDING" } } },
        ],
      },
      include: LOT_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
  } else {
    const pending = await prisma.lot.findMany({
      where: {
        OR: [
          { status: "PENDING_REVIEW" },
          { status: "LIVE", revisions: { some: { status: "PENDING" } } },
        ],
      },
      include: LOT_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    lots = [];
    for (const lot of pending) {
      if (!(await otherOfficerExists(lot.cooperativeId, lot.farmerUserId))) lots.push(lot);
    }
  }
  return Promise.all(
    lots.map(async (lot) => ({
      ...toOfficerLot(lot, await photoUrlsOf(lot.id)),
      canApprove: actor.userId !== lot.farmerUserId && (await mayScreen(actor, lot)),
    })),
  );
}

// One lot for the screening page. An officer of another cooperative, or an admin for a lot a
// cooperative officer can screen, gets "not found".
export async function getLotForScreening(
  actor: Actor,
  lotId: string,
  now: Date = new Date(),
): Promise<ScreeningLot & { boardPrices: BoardPrice[] }> {
  if (!can(actor, "lot:screen", { cooperativeId: actor.cooperativeId ?? undefined })) {
    throw new ForbiddenError();
  }
  const lot = await prisma.lot.findUnique({ where: { id: lotId }, include: LOT_INCLUDE });
  if (!lot) throw new NotFoundError("LOT_NOT_FOUND");
  const ownCooperative = actor.role === "OFFICER" && actor.cooperativeId === lot.cooperativeId;
  const allowed = await mayScreen(actor, lot);
  if (!ownCooperative && !allowed) throw new NotFoundError("LOT_NOT_FOUND");
  return {
    ...toOfficerLot(lot, await photoUrlsOf(lot.id)),
    canApprove: actor.userId !== lot.farmerUserId && allowed,
    boardPrices: await boardReference(lot.cropId, lot.unitId, now),
  };
}
