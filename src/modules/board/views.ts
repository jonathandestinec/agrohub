import type { Crop, PricePoint, Unit } from "@/generated/prisma/client";
import { toWeekKey } from "./week";

export type BoardEntry = {
  id: string;
  crop: string;
  unit: string;
  market: string;
  weekOf: string;
  priceKobo: number;
};

export function toBoardEntry(point: PricePoint & { crop: Crop; unit: Unit }): BoardEntry {
  return {
    id: point.id,
    crop: point.crop.name,
    unit: point.unit.name,
    market: point.market,
    weekOf: toWeekKey(point.weekOf),
    priceKobo: point.priceKobo,
  };
}

export type PublicBoardRow = {
  crop: string;
  unit: string;
  market: string;
  weekOf: string;
  priceKobo: number;
  previousKobo: number | null;
};

// The latest price for one crop, unit and market, with the most recent earlier week's.
// Only names and prices: never who recorded it.
export function toPublicBoardRow(row: {
  crop: string;
  unit: string;
  market: string;
  weekOf: Date;
  priceKobo: number;
  previousKobo: number | null;
}): PublicBoardRow {
  return {
    crop: row.crop,
    unit: row.unit,
    market: row.market,
    weekOf: toWeekKey(row.weekOf),
    priceKobo: row.priceKobo,
    previousKobo: row.previousKobo,
  };
}
