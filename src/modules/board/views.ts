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
