import type { LotGrade } from "@/generated/prisma/client";
import { toKobo } from "@/lib/money";
import { STATES } from "@/modules/geo/states";

export const LOT_SORTS = ["newest", "price_asc", "price_desc"] as const;
export type LotSort = (typeof LOT_SORTS)[number];
const GRADES: readonly LotGrade[] = ["A", "B", "C", "UNGRADED"];

export type LotFilters = {
  cropId?: string;
  state?: string;
  grade?: LotGrade;
  minPriceKobo?: number;
  maxPriceKobo?: number;
  minQuantity?: number;
  cooperativeId?: string;
  sort: LotSort;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;

function first(params: Params, key: string): string | undefined {
  const raw = params[key];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value ? value : undefined;
}

function priceKobo(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  try {
    const kobo = toKobo(value.replace(/,/g, ""));
    return kobo > 0 ? kobo : undefined;
  } catch {
    return undefined;
  }
}

function positiveWhole(value: string | undefined): number | undefined {
  return value !== undefined && /^\d{1,7}$/.test(value) && Number(value) > 0 ? Number(value) : undefined;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

// Pure: lot filters from URL search params. Values that do not parse are dropped rather than
// refused, since they come from a link anyone can edit.
export function parseLotFilters(params: Params): LotFilters {
  const filters: LotFilters = { sort: "newest", page: 1 };
  const cropId = first(params, "cropId");
  if (cropId && ID.test(cropId)) filters.cropId = cropId;
  const cooperativeId = first(params, "cooperativeId");
  if (cooperativeId && ID.test(cooperativeId)) filters.cooperativeId = cooperativeId;
  const state = first(params, "state");
  if (state && (STATES as readonly string[]).includes(state)) filters.state = state;
  const grade = first(params, "grade");
  if (grade && (GRADES as readonly string[]).includes(grade)) filters.grade = grade as LotGrade;
  const minPriceKobo = priceKobo(first(params, "minPrice"));
  if (minPriceKobo !== undefined) filters.minPriceKobo = minPriceKobo;
  const maxPriceKobo = priceKobo(first(params, "maxPrice"));
  if (maxPriceKobo !== undefined) filters.maxPriceKobo = maxPriceKobo;
  const minQuantity = positiveWhole(first(params, "minQuantity"));
  if (minQuantity !== undefined) filters.minQuantity = minQuantity;
  const sort = first(params, "sort");
  if (sort && (LOT_SORTS as readonly string[]).includes(sort)) filters.sort = sort as LotSort;
  const page = positiveWhole(first(params, "page"));
  if (page !== undefined) filters.page = page;
  return filters;
}
