import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/audit";
import { can, type Actor } from "@/modules/identity/policies";
import { recordPriceInput, weekInput, type RecordPriceInput } from "./schema";
import {
  toBoardEntry,
  toPublicBoardRow,
  type BoardEntry,
  type PublicBoardRow,
} from "./views";
import { toWeekKey, weekStart } from "./week";

export type { BoardEntry, PublicBoardRow };

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
  const write = { actor, key, meta, market, priceKobo };
  try {
    return await writePrice(write);
  } catch (error) {
    // A concurrent double submit won the insert: once more, which takes the update path.
    if (!isUniqueViolation(error)) throw error;
    return writePrice(write);
  }
}

// The price and its audit row commit together, so a failed audit never leaves an
// unaudited change behind. The existing row is locked, so concurrent corrections each
// audit the price they actually replaced.
async function writePrice({
  actor,
  key,
  meta,
  market,
  priceKobo,
}: {
  actor: Actor;
  key: { cropId: string; unitId: string; marketKey: string; weekOf: Date };
  meta: { cropId: string; unitId: string; weekOf: string };
  market: string;
  priceKobo: number;
}): Promise<BoardEntry> {
  return prisma.$transaction(async (tx) => {
    const where = { cropId_unitId_marketKey_weekOf: key };
    const found = await tx.pricePoint.findUnique({ where, select: { id: true } });
    if (!found) {
      const spelling = await boardSpelling(tx, key.marketKey, market);
      const created = await tx.pricePoint.create({
        data: { ...key, market: spelling, priceKobo, recordedByUserId: actor.userId },
        include: WITH_NAMES,
      });
      await recordAudit(
        {
          actorId: actor.userId,
          action: "price.record",
          entity: "price_point",
          entityId: created.id,
          meta: { ...meta, priceKobo },
        },
        tx,
      );
      return toBoardEntry(created);
    }

    await tx.$queryRaw`SELECT id FROM price_point WHERE id = ${found.id} FOR UPDATE`;
    const existing = await tx.pricePoint.findUniqueOrThrow({
      where: { id: found.id },
      include: WITH_NAMES,
    });
    // An identical resubmit changes nothing, not even who recorded it.
    if (existing.priceKobo === priceKobo) return toBoardEntry(existing);
    // A correction changes the price only; the market keeps the spelling on the board.
    const updated = await tx.pricePoint.update({
      where: { id: existing.id },
      data: { priceKobo, recordedByUserId: actor.userId },
      include: WITH_NAMES,
    });
    await recordAudit(
      {
        actorId: actor.userId,
        action: "price.update",
        entity: "price_point",
        entityId: existing.id,
        meta: { ...meta, fromKobo: existing.priceKobo, toKobo: priceKobo },
      },
      tx,
    );
    return toBoardEntry(updated);
  });
}

// The spelling a market already has on the board (any crop, any week), so one market
// never shows two ways. A market new to the board keeps the spelling typed.
async function boardSpelling(client: MarketClient, marketKey: string, typed: string): Promise<string> {
  const known = await client.pricePoint.findFirst({
    where: { marketKey },
    orderBy: { createdAt: "asc" },
    select: { market: true },
  });
  return known?.market ?? typed;
}

type MarketClient = Pick<typeof prisma, "pricePoint">;

// Market names already on the board, for the price form to suggest.
export async function listMarkets(actor: Actor): Promise<string[]> {
  if (!can(actor, "price:write")) throw new ForbiddenError();
  const rows = await prisma.pricePoint.findMany({
    distinct: ["marketKey"],
    orderBy: [{ marketKey: "asc" }, { createdAt: "asc" }],
    select: { market: true },
  });
  return rows.map((r) => r.market);
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

type BoardRow = {
  crop: string;
  unit: string;
  market: string;
  weekOf: Date;
  priceKobo: number;
  previousKobo: number | null;
  previousWeekOf: Date | null;
};

// How far back the public board looks. A price older than a year is no longer market
// information, and the bound keeps each visit to an index range on weekOf.
export const BOARD_WINDOW_WEEKS = 52;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// The public price board: no Actor, because farmers, buyers and signed-out visitors all
// read it and it holds no private fields. One row per active crop, active unit and market
// priced in the last 52 weeks: the latest week's price and the most recent earlier one's.
export async function listPublicBoard(
  filter: { cropId?: string } = {},
  now: Date = new Date(),
): Promise<PublicBoardRow[]> {
  const cropFilter = filter.cropId ? Prisma.sql`AND p."cropId" = ${filter.cropId}` : Prisma.empty;
  const since = new Date(weekStart(now).getTime() - BOARD_WINDOW_WEEKS * WEEK_MS);
  const rows = await prisma.$queryRaw<BoardRow[]>`
    SELECT crop, unit, market, "weekOf", "priceKobo", "previousKobo", "previousWeekOf"
    FROM (
      SELECT c.name AS crop, u.name AS unit, p.market, p."weekOf", p."priceKobo",
             c."nameKey" AS crop_key, u."nameKey" AS unit_key, p."marketKey",
             LEAD(p."priceKobo") OVER w AS "previousKobo",
             LEAD(p."weekOf") OVER w AS "previousWeekOf",
             ROW_NUMBER() OVER w AS rank
      FROM price_point p
      JOIN crop c ON c.id = p."cropId" AND c.active
      JOIN unit u ON u.id = p."unitId" AND u.active
      WHERE p."weekOf" >= ${since}::date ${cropFilter}
      WINDOW w AS (PARTITION BY p."cropId", p."unitId", p."marketKey" ORDER BY p."weekOf" DESC)
    ) ranked
    WHERE rank = 1
    ORDER BY crop_key, unit_key, "marketKey"
  `;
  return rows.map(toPublicBoardRow);
}
