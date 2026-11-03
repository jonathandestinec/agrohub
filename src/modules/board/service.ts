import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/audit";
import { can, type Actor } from "@/modules/identity/policies";
import { recordPriceInput, weekInput, type RecordPriceInput } from "./schema";
import { toBoardEntry, type BoardEntry } from "./views";
import { toWeekKey, weekStart } from "./week";

export type { BoardEntry };

const WITH_NAMES = { crop: true, unit: true } as const;

// Any date in a week maps to that week's Monday. Noon UTC is inside the same Lagos day.
function mondayOf(isoDate: string): Date {
  return weekStart(new Date(`${isoDate}T12:00:00Z`));
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// Records or corrects one board price. Recording publishes: the price is on the public
// board at once. A second entry for the same crop, unit, market and week updates the row.
export async function recordPrice(
  actor: Actor,
  input: RecordPriceInput,
  now: Date = new Date(),
): Promise<BoardEntry> {
  if (!can(actor, "price:write")) throw new ForbiddenError();
  const parsed = recordPriceInput.safeParse(input);
  if (!parsed.success) throw new ValidationError("Invalid price entry", "INVALID_PRICE_ENTRY");
  const { cropId, unitId, market, priceKobo } = parsed.data;
  const weekOf = mondayOf(parsed.data.weekOf);
  if (weekOf.getTime() > weekStart(now).getTime()) {
    throw new ValidationError("Week is in the future", "FUTURE_WEEK");
  }

  const [crop, unit] = await Promise.all([
    prisma.crop.findUnique({ where: { id: cropId } }),
    prisma.unit.findUnique({ where: { id: unitId } }),
  ]);
  if (!crop?.active) throw new ValidationError("Crop is not active", "CROP_INACTIVE");
  if (!unit?.active) throw new ValidationError("Unit is not active", "UNIT_INACTIVE");

  const key = { cropId, unitId, marketKey: market.toLowerCase(), weekOf };
  const meta = { cropId, unitId, weekOf: toWeekKey(weekOf) };
  const existing = await prisma.pricePoint.findUnique({
    where: { cropId_unitId_marketKey_weekOf: key },
  });
  if (!existing) {
    try {
      const created = await prisma.pricePoint.create({
        data: { ...key, market, priceKobo, recordedByUserId: actor.userId },
        include: WITH_NAMES,
      });
      await recordAudit({
        actorId: actor.userId,
        action: "price.record",
        entity: "price_point",
        entityId: created.id,
        meta: { ...meta, priceKobo },
      });
      return toBoardEntry(created);
    } catch (error) {
      // A double submit won the insert: run again, which takes the update path.
      if (!isUniqueViolation(error)) throw error;
      return recordPrice(actor, input, now);
    }
  }

  const updated = await prisma.pricePoint.update({
    where: { id: existing.id },
    data: { market, priceKobo, recordedByUserId: actor.userId },
    include: WITH_NAMES,
  });
  if (existing.priceKobo !== priceKobo) {
    await recordAudit({
      actorId: actor.userId,
      action: "price.update",
      entity: "price_point",
      entityId: existing.id,
      meta: { ...meta, fromKobo: existing.priceKobo, toKobo: priceKobo },
    });
  }
  return toBoardEntry(updated);
}

// The week's entries for the board admin's screen, sorted by crop, unit and market.
export async function listWeek(actor: Actor, weekOf: string): Promise<BoardEntry[]> {
  if (!can(actor, "price:write")) throw new ForbiddenError();
  if (!weekInput.safeParse(weekOf).success) {
    throw new ValidationError("Invalid week", "INVALID_WEEK");
  }
  const points = await prisma.pricePoint.findMany({
    where: { weekOf: mondayOf(weekOf) },
    include: WITH_NAMES,
    orderBy: [{ crop: { nameKey: "asc" } }, { unit: { nameKey: "asc" } }, { marketKey: "asc" }],
  });
  return points.map(toBoardEntry);
}
