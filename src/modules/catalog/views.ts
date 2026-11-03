import type {
  CatalogKind,
  CatalogRequest,
  CatalogRequestStatus,
  Crop,
  Unit,
} from "@/generated/prisma/client";

export type CatalogItem = { id: string; name: string; active: boolean };

export function toCatalogItem(item: Crop | Unit): CatalogItem {
  return { id: item.id, name: item.name, active: item.active };
}

export type CatalogRequestView = {
  id: string;
  kind: CatalogKind;
  name: string;
  status: CatalogRequestStatus;
  declineReason: string | null;
  resolvedItemName: string | null;
  createdAt: string;
};

// The officer also sees which member asked; never their phone or email.
export type OfficerCatalogRequestView = CatalogRequestView & { farmerName: string };

// Forwarded requests for one kind and name, as the board admin decides them.
export type BoardCatalogRequestGroup = {
  id: string;
  kind: CatalogKind;
  name: string;
  requestIds: string[];
  cooperativeNames: string[];
  since: string;
};

export function toCatalogRequestView(
  row: CatalogRequest,
  resolvedNames: Map<string, string>,
): CatalogRequestView {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    declineReason: row.declineReason,
    resolvedItemName: row.resolvedItemId ? (resolvedNames.get(row.resolvedItemId) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  };
}
