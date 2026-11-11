import { randomBytes } from "node:crypto";
import type { Deviation } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, isDateKey, lagosDate, lagosDateKey } from "@/lib/lagos-date";
import { effectiveCutBps } from "@/lib/money";
import { putPrivate, signedUrl } from "@/lib/storage";
import { recordAudit } from "@/modules/audit/audit";
import { askDeviation } from "@/modules/board/deviation";
import { boardReference, boardReferences, type BoardPrice } from "@/modules/board/service";
import { can, type Actor } from "@/modules/identity/policies";
import { notify, officersOf } from "@/modules/notifications/service";
import { getPlatformSettings } from "@/modules/settings/service";
import { MAX_AVAILABLE_DAYS, NOTE_MIN_WHEN_WARNED, submitLotInput, type SubmitLotInput } from "./lot-schema";
import { MAX_PHOTOS, validatePhoto } from "./photos";
import { toFarmerLot, type FarmerLot, type LotRow } from "./views";

export const PHOTO_URL_TTL_SECONDS = 3600;

// Everything the lot views need; the rows this loads are LotRow.
export const LOT_INCLUDE = {
  crop: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true } },
  feeTerms: true,
  cooperative: { select: { name: true } },
  farmer: { select: { name: true } },
  revisions: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1 },
} as const;

export async function photoUrlsOf(lotId: string): Promise<string[]> {
  const photos = await prisma.lotPhoto.findMany({ where: { lotId }, orderBy: { position: "asc" } });
  return Promise.all(photos.map((p) => signedUrl(p.storageKey, PHOTO_URL_TTL_SECONDS)));
}

export async function loadLot(lotId: string): Promise<LotRow> {
  const lot = await prisma.lot.findUnique({ where: { id: lotId }, include: LOT_INCLUDE });
  if (!lot) throw new NotFoundError("LOT_NOT_FOUND");
  return lot;
}

// The neutral board warning, and the note it requires. Shared by submission and revisions.
export async function checkAgainstBoard(
  input: { cropId: string; unitId: string; askKobo: number; note?: string },
  thresholdBps: number,
  now: Date,
): Promise<Deviation | null> {
  const prices = await boardReference(input.cropId, input.unitId, now);
  const deviation = askDeviation(input.askKobo, prices.map((p) => p.priceKobo), thresholdBps);
  if ((deviation === "HIGH" || deviation === "LOW") && (input.note ?? "").length < NOTE_MIN_WHEN_WARNED) {
    throw new ValidationError("Explain the price in a note", "NOTE_REQUIRED");
  }
  return deviation;
}

export function assertFloorAtMostAsk(askKobo: number, floorKobo: number): void {
  if (floorKobo > askKobo) {
    throw new ValidationError("The lowest price must not be above the asking price", "FLOOR_ABOVE_ASK");
  }
}

// A farmer submits a lot to their cooperative's officers. The cut and fee shown to the farmer
// are stored with it, so approval locks the terms they agreed to.
export async function submitLot(
  actor: Actor,
  input: SubmitLotInput,
  photos: { body: Buffer; contentType: string }[],
  now: Date = new Date(),
): Promise<FarmerLot> {
  const cooperativeId = actor.cooperativeId;
  if (cooperativeId === null || !can(actor, "lot:submit", { cooperativeId })) {
    throw new ForbiddenError();
  }
  const parsed = submitLotInput.safeParse(input);
  if (!parsed.success) throw new ValidationError("Invalid lot", "INVALID_LOT");
  const fields = parsed.data;
  assertFloorAtMostAsk(fields.askKobo, fields.floorKobo);

  const today = lagosDateKey(now);
  if (
    !isDateKey(fields.availableUntil) ||
    fields.availableUntil < today ||
    fields.availableUntil > addDays(today, MAX_AVAILABLE_DAYS)
  ) {
    throw new ValidationError("Choose a date from today to 90 days ahead", "INVALID_AVAILABLE_UNTIL");
  }
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > MAX_PHOTOS) {
    throw new ValidationError("Add one to four photos", "PHOTO_COUNT");
  }
  photos.forEach(validatePhoto);

  const [cooperative, profile, crop, unit, settings] = await Promise.all([
    prisma.cooperative.findUnique({ where: { id: cooperativeId }, select: { status: true, cutBps: true } }),
    prisma.farmerProfile.findUnique({ where: { userId: actor.userId }, select: { recipientCode: true } }),
    prisma.crop.findUnique({ where: { id: fields.cropId }, select: { active: true } }),
    prisma.unit.findUnique({ where: { id: fields.unitId }, select: { active: true } }),
    getPlatformSettings(),
  ]);
  if (cooperative?.status !== "VERIFIED") {
    throw new ForbiddenError("COOPERATIVE_NOT_VERIFIED");
  }
  if (!profile?.recipientCode) {
    throw new ValidationError("Add a bank account before listing", "BANK_ACCOUNT_REQUIRED");
  }
  if (!crop?.active) throw new ValidationError("Crop is not active", "CROP_INACTIVE");
  if (!unit?.active) throw new ValidationError("Unit is not active", "UNIT_INACTIVE");

  const deviation = await checkAgainstBoard(fields, settings.priceDeviationBps, now);

  // Stored before the rows that point at them; an orphaned object after a failed insert is
  // harmless, a row pointing at a missing object is not.
  const stored: { storageKey: string; contentType: string; sizeBytes: number; position: number }[] = [];
  for (const [position, photo] of photos.entries()) {
    const storageKey = `lots/${cooperativeId}/${randomBytes(12).toString("hex")}`;
    await putPrivate(storageKey, photo.body, photo.contentType);
    stored.push({ storageKey, contentType: photo.contentType, sizeBytes: photo.body.length, position });
  }

  const lot = await prisma.$transaction(async (tx) => {
    const created = await tx.lot.create({
      data: {
        cooperativeId,
        farmerUserId: actor.userId,
        cropId: fields.cropId,
        unitId: fields.unitId,
        quantity: fields.quantity,
        grade: fields.grade,
        pickupState: fields.pickupState,
        pickupLga: fields.pickupLga,
        pickupNote: fields.pickupNote ?? null,
        askKobo: fields.askKobo,
        floorKobo: fields.floorKobo,
        note: fields.note ?? null,
        deviation,
        quotedCutBps: effectiveCutBps(cooperative.cutBps, settings.maxCooperativeCutBps),
        quotedFeeBps: settings.platformFeeBps,
        availableUntil: lagosDate(fields.availableUntil),
        contributions: { create: { farmerUserId: actor.userId, quantity: fields.quantity } },
        photos: { create: stored },
      },
      include: LOT_INCLUDE,
    });
    // Ids, kobo and statuses only: never the floor.
    await recordAudit(
      {
        actorId: actor.userId,
        action: "lot.submit",
        entity: "lot",
        entityId: created.id,
        meta: {
          lotId: created.id,
          cooperativeId,
          askKobo: created.askKobo,
          quantity: created.quantity,
          deviation,
        },
      },
      tx,
    );
    await notify(tx, {
      kind: "LOT_SUBMITTED",
      subject: { type: "LOT", id: created.id },
      data: { crop: created.crop.name },
      to: await officersOf(tx, cooperativeId),
      exclude: actor.userId,
    });
    return created;
  });
  return toFarmerLot(lot, await photoUrlsOf(lot.id));
}

// ---- The farmer's own lots ----

export async function listOwnLots(actor: Actor): Promise<FarmerLot[]> {
  const cooperativeId = actor.cooperativeId;
  if (cooperativeId === null || !can(actor, "lot:own", { cooperativeId, ownerUserId: actor.userId })) {
    throw new ForbiddenError();
  }
  const lots = await prisma.lot.findMany({
    where: { farmerUserId: actor.userId, cooperativeId },
    include: LOT_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(lots.map(async (lot) => toFarmerLot(lot, await photoUrlsOf(lot.id))));
}

// Another farmer's lot is "not found", never "forbidden", so lot ids cannot be probed.
export async function loadOwnLot(actor: Actor, lotId: string): Promise<LotRow> {
  const lot = await prisma.lot.findUnique({ where: { id: lotId }, include: LOT_INCLUDE });
  if (!lot || !can(actor, "lot:own", { cooperativeId: lot.cooperativeId, ownerUserId: lot.farmerUserId })) {
    throw new NotFoundError("LOT_NOT_FOUND");
  }
  return lot;
}

export async function getOwnLot(actor: Actor, lotId: string): Promise<FarmerLot> {
  const lot = await loadOwnLot(actor, lotId);
  return toFarmerLot(lot, await photoUrlsOf(lot.id));
}

export type LotFormContext = {
  // Why the farmer cannot list yet, or null when they can.
  blockedBy: "COOPERATIVE_NOT_VERIFIED" | "BANK_ACCOUNT_REQUIRED" | null;
  quotedCutBps: number;
  platformFeeBps: number;
  priceDeviationBps: number;
  crops: { id: string; name: string }[];
  units: { id: string; name: string }[];
  // Each market's latest board price, keyed "cropId:unitId", for the live warning.
  boardPrices: Record<string, BoardPrice[]>;
  pickupState: string;
  pickupLga: string;
  today: string;
};

// What the lot form needs: the terms the farmer will be quoted, the lists, and the board.
export async function getLotFormContext(actor: Actor, now: Date = new Date()): Promise<LotFormContext> {
  const cooperativeId = actor.cooperativeId;
  if (cooperativeId === null || !can(actor, "lot:submit", { cooperativeId })) {
    throw new ForbiddenError();
  }
  const [cooperative, profile, settings, crops, units, references] = await Promise.all([
    prisma.cooperative.findUnique({ where: { id: cooperativeId }, select: { status: true, cutBps: true } }),
    prisma.farmerProfile.findUnique({
      where: { userId: actor.userId },
      select: { recipientCode: true, state: true, lga: true },
    }),
    getPlatformSettings(),
    prisma.crop.findMany({ where: { active: true }, orderBy: { nameKey: "asc" }, select: { id: true, name: true } }),
    prisma.unit.findMany({ where: { active: true }, orderBy: { nameKey: "asc" }, select: { id: true, name: true } }),
    boardReferences({}, now),
  ]);
  return {
    blockedBy:
      cooperative?.status !== "VERIFIED"
        ? "COOPERATIVE_NOT_VERIFIED"
        : !profile?.recipientCode
          ? "BANK_ACCOUNT_REQUIRED"
          : null,
    quotedCutBps: effectiveCutBps(cooperative?.cutBps ?? 0, settings.maxCooperativeCutBps),
    platformFeeBps: settings.platformFeeBps,
    priceDeviationBps: settings.priceDeviationBps,
    crops,
    units,
    boardPrices: Object.fromEntries(references),
    pickupState: profile?.state ?? "",
    pickupLga: profile?.lga ?? "",
    today: lagosDateKey(now),
  };
}
