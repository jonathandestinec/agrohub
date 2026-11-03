import type { Crop, Unit } from "@/generated/prisma/client";

export type CatalogItem = { id: string; name: string; active: boolean };

export function toCatalogItem(item: Crop | Unit): CatalogItem {
  return { id: item.id, name: item.name, active: item.active };
}
