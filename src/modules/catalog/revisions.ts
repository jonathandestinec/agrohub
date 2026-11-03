import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/audit";
import type { Actor } from "@/modules/identity/policies";
import { getPlatformSettings } from "@/modules/settings/service";
import { revisionInput, type RevisionInput } from "./lot-schema";
import { assertFloorAtMostAsk, checkAgainstBoard, loadLot, loadOwnLot, photoUrlsOf } from "./lots";
import { hasOpenOrders } from "./orders-guard";
import { assertMayScreen } from "./screening";
import { toFarmerLot, type FarmerLot } from "./views";

const REASON_MIN = 3;
const REASON_MAX = 500;
const WITHDRAWABLE = ["PENDING_REVIEW", "COUNTERED", "LIVE"] as const;

async function farmerView(lotId: string): Promise<FarmerLot> {
  const lot = await loadLot(lotId);
  return toFarmerLot(lot, await photoUrlsOf(lot.id));
}

// The farmer asks to change a live lot's price, quantity or floor. The live version stays
// until an officer approves the change; a newer request replaces an older pending one.
export async function requestRevision(
  actor: Actor,
  lotId: string,
  input: RevisionInput,
  now: Date = new Date(),
): Promise<FarmerLot> {
  const lot = await loadOwnLot(actor, lotId);
  if (lot.status !== "LIVE") throw new ConflictError("Only a live lot can be edited", "LOT_NOT_LIVE");
  const parsed = revisionInput.safeParse(input);
  if (!parsed.success) throw new ValidationError("Invalid change", "INVALID_LOT");
  const change = parsed.data;
  assertFloorAtMostAsk(change.askKobo, change.floorKobo);
  if (change.quantity < lot.minOrderQty) {
    throw new ValidationError("Quantity below the minimum order", "QUANTITY_BELOW_MIN_ORDER");
  }
  const settings = await getPlatformSettings();
  const deviation = await checkAgainstBoard(
    { cropId: lot.cropId, unitId: lot.unitId, askKobo: change.askKobo, note: change.note },
    settings.priceDeviationBps,
    now,
  );

  await prisma.$transaction(async (tx) => {
    await tx.lotRevision.updateMany({
      where: { lotId: lot.id, status: "PENDING" },
      data: { status: "SUPERSEDED", decidedAt: now },
    });
    const revision = await tx.lotRevision.create({
      data: {
        lotId: lot.id,
        askKobo: change.askKobo,
        quantity: change.quantity,
        floorKobo: change.floorKobo,
        note: change.note ?? null,
        deviation,
      },
    });
    await recordAudit(
      {
        actorId: actor.userId,
        action: "lot.revise",
        entity: "lot",
        entityId: lot.id,
        meta: { lotId: lot.id, revisionId: revision.id, askKobo: change.askKobo, quantity: change.quantity },
      },
      tx,
    );
  });
  return farmerView(lot.id);
}

// An officer (or the admin fallback) decides a pending revision under the self-approval rule.
// Approving copies the change onto the lot; its locked fee terms stay as they are.
export async function decideRevision(
  actor: Actor,
  revisionId: string,
  input: { approve: boolean; reason?: string },
  now: Date = new Date(),
): Promise<void> {
  const revision = await prisma.lotRevision.findUnique({ where: { id: revisionId } });
  if (!revision) throw new NotFoundError("REVISION_NOT_FOUND");
  const lot = await loadLot(revision.lotId);
  await assertMayScreen(actor, lot);
  const approve = input?.approve === true;
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  if (!approve && (reason.length < REASON_MIN || reason.length > REASON_MAX)) {
    throw new ValidationError("A reason is required", "REASON_REQUIRED");
  }

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.lotRevision.updateMany({
      where: { id: revision.id, status: "PENDING" },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        reason: approve ? null : reason,
        screenedByUserId: actor.userId,
        decidedAt: now,
      },
    });
    if (count === 0) throw new ConflictError("Change already answered", "REVISION_NOT_PENDING");
    if (approve) {
      const updated = await tx.lot.updateMany({
        where: { id: lot.id, status: "LIVE" },
        data: {
          askKobo: revision.askKobo,
          quantity: revision.quantity,
          floorKobo: revision.floorKobo,
          note: revision.note,
          deviation: revision.deviation,
        },
      });
      if (updated.count === 0) throw new ConflictError("Only a live lot can be edited", "LOT_NOT_LIVE");
      // One farmer per lot (Phase 3): their contribution is the whole quantity.
      await tx.lotContribution.updateMany({
        where: { lotId: lot.id, farmerUserId: lot.farmerUserId },
        data: { quantity: revision.quantity },
      });
    }
    await recordAudit(
      {
        actorId: actor.userId,
        action: approve ? "lot.revision_approve" : "lot.revision_reject",
        entity: "lot",
        entityId: lot.id,
        meta: approve
          ? { lotId: lot.id, revisionId: revision.id, askKobo: revision.askKobo, quantity: revision.quantity }
          : { lotId: lot.id, revisionId: revision.id },
      },
      tx,
    );
  });
}

// A farmer withdraws a lot that is waiting, countered or live, while no order on it is open.
export async function withdrawLot(actor: Actor, lotId: string, now: Date = new Date()): Promise<FarmerLot> {
  const lot = await loadOwnLot(actor, lotId);
  if (!(WITHDRAWABLE as readonly string[]).includes(lot.status)) {
    throw new ConflictError("This lot cannot be withdrawn", "LOT_NOT_WITHDRAWABLE");
  }
  if (await hasOpenOrders(lot.id)) {
    throw new ConflictError("This lot has open orders", "LOT_HAS_OPEN_ORDERS");
  }
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.lot.updateMany({
      where: { id: lot.id, status: { in: [...WITHDRAWABLE] } },
      data: { status: "WITHDRAWN", counterAskKobo: null, counterMessage: null },
    });
    if (count === 0) throw new ConflictError("This lot cannot be withdrawn", "LOT_NOT_WITHDRAWABLE");
    await tx.lotRevision.updateMany({
      where: { lotId: lot.id, status: "PENDING" },
      data: { status: "SUPERSEDED", decidedAt: now },
    });
    await recordAudit(
      {
        actorId: actor.userId,
        action: "lot.withdraw",
        entity: "lot",
        entityId: lot.id,
        meta: { lotId: lot.id, fromStatus: lot.status },
      },
      tx,
    );
  });
  return farmerView(lot.id);
}
