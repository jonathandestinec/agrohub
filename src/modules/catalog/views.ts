import type {
  CatalogKind,
  CatalogRequest,
  CatalogRequestStatus,
  Crop,
  Deviation,
  Lot,
  LotFeeTerms,
  LotGrade,
  LotRevision,
  LotStatus,
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

// ---- Lots ----

// A lot row with what every view needs. LOT_INCLUDE in lots.ts loads exactly this.
export type LotRow = Lot & {
  crop: Pick<Crop, "id" | "name">;
  unit: Pick<Unit, "id" | "name">;
  feeTerms: LotFeeTerms | null;
  cooperative: { name: string };
  farmer: { name: string };
  // The pending revision, if any (LOT_INCLUDE loads at most one).
  revisions: LotRevision[];
};

export type PendingRevision = {
  id: string;
  askKobo: number;
  quantity: number;
  floorKobo: number;
  note: string | null;
  deviation: Deviation | null;
  createdAt: string;
};

export type LotTerms = { cooperativeCutBps: number; platformFeeBps: number };

// The owner's view: everything about their lot, the private floor included.
export type FarmerLot = {
  id: string;
  status: LotStatus;
  crop: { id: string; name: string };
  unit: { id: string; name: string };
  quantity: number;
  grade: LotGrade;
  pickupState: string;
  pickupLga: string;
  pickupNote: string | null;
  askKobo: number;
  floorKobo: number;
  note: string | null;
  deviation: Deviation | null;
  quoted: LotTerms;
  lockedTerms: LotTerms | null;
  minOrderQty: number;
  availableUntil: string;
  counterAskKobo: number | null;
  counterMessage: string | null;
  rejectionReason: string | null;
  photoUrls: string[];
  createdAt: string;
  approvedAt: string | null;
  pendingRevision: PendingRevision | null;
};

// The screening view: the officer sees the floor (they negotiate for the cooperative) and
// which member submitted it, but no phone, email or bank data.
export type OfficerLot = FarmerLot & { farmerUserId: string; farmerName: string };

// What buyers and signed-out visitors see. Deliberately has no floor, no farmer identity, no
// note to the officer and no screening fields: build it field by field, never by spreading.
export type PublicLot = {
  id: string;
  cooperativeName: string;
  crop: string;
  unit: string;
  quantity: number;
  grade: LotGrade;
  pickupState: string;
  pickupLga: string;
  askKobo: number;
  minOrderQty: number;
  availableUntil: string;
  photoUrls: string[];
};

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

export function toFarmerLot(lot: LotRow, photoUrls: string[]): FarmerLot {
  return {
    id: lot.id,
    status: lot.status,
    crop: { id: lot.crop.id, name: lot.crop.name },
    unit: { id: lot.unit.id, name: lot.unit.name },
    quantity: lot.quantity,
    grade: lot.grade,
    pickupState: lot.pickupState,
    pickupLga: lot.pickupLga,
    pickupNote: lot.pickupNote,
    askKobo: lot.askKobo,
    floorKobo: lot.floorKobo,
    note: lot.note,
    deviation: lot.deviation,
    quoted: { cooperativeCutBps: lot.quotedCutBps, platformFeeBps: lot.quotedFeeBps },
    lockedTerms: lot.feeTerms
      ? {
          cooperativeCutBps: lot.feeTerms.cooperativeCutBps,
          platformFeeBps: lot.feeTerms.platformFeeBps,
        }
      : null,
    minOrderQty: lot.minOrderQty,
    availableUntil: dateKey(lot.availableUntil),
    counterAskKobo: lot.counterAskKobo,
    counterMessage: lot.counterMessage,
    rejectionReason: lot.rejectionReason,
    photoUrls,
    createdAt: lot.createdAt.toISOString(),
    approvedAt: lot.approvedAt?.toISOString() ?? null,
    pendingRevision: toPendingRevision(lot.revisions.find((r) => r.status === "PENDING")),
  };
}

function toPendingRevision(revision: LotRevision | undefined): PendingRevision | null {
  if (!revision) return null;
  return {
    id: revision.id,
    askKobo: revision.askKobo,
    quantity: revision.quantity,
    floorKobo: revision.floorKobo,
    note: revision.note,
    deviation: revision.deviation,
    createdAt: revision.createdAt.toISOString(),
  };
}

export function toOfficerLot(lot: LotRow, photoUrls: string[]): OfficerLot {
  return { ...toFarmerLot(lot, photoUrls), farmerUserId: lot.farmerUserId, farmerName: lot.farmer.name };
}

export function toPublicLot(lot: LotRow, photoUrls: string[]): PublicLot {
  return {
    id: lot.id,
    cooperativeName: lot.cooperative.name,
    crop: lot.crop.name,
    unit: lot.unit.name,
    quantity: lot.quantity,
    grade: lot.grade,
    pickupState: lot.pickupState,
    pickupLga: lot.pickupLga,
    askKobo: lot.askKobo,
    minOrderQty: lot.minOrderQty,
    availableUntil: dateKey(lot.availableUntil),
    photoUrls,
  };
}
