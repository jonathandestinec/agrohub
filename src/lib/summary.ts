// Shapes for the role home pages: a to-do tile is a count and the oldest few items, a history
// tile is the newest few. Items hold data only; any words come through `label`, a message key.

export type TileItem = {
  id: string;
  href: string;
  /** Data only, e.g. "12 Bag · Maize" (quantity, unit, crop) or a person's name. */
  title: string;
  /** A name, or an amount already formatted with formatNaira. */
  detail?: string;
  /** An ISO date or date-time. */
  date?: string;
  /** A full message key, e.g. "orders.status.UNDER_REVIEW" or "home.labels.CANCEL_REQUESTED". */
  label?: string;
};

/** To-do tiles: the count and the oldest TILE_ITEMS items. */
export type Summary = { count: number; items: TileItem[] };
/** History tiles: the newest TILE_ITEMS items, no count. */
export type History = { items: TileItem[] };

export const TILE_ITEMS = 3;

/** "0".."99", then "99+", so a tile keeps its size. */
export function countLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** "12 Bag · Maize": the quantity, unit and crop of a lot, offer or order. Data only. */
export function quantityTitle(quantity: number, unit: string, crop: string): string {
  return `${quantity} ${unit} · ${crop}`;
}
