import type { TileItem } from "@/lib/summary";
import type {
  NameChangeRequest,
  NameChangeStatus,
  NameDocumentKind,
  NameSubjectType,
} from "@/generated/prisma/client";

// What the requester (and their cooperative's officers) see of a request.
export type OwnNameChange = {
  id: string;
  subjectType: NameSubjectType;
  fromName: string;
  toName: string;
  documentKind: NameDocumentKind;
  status: NameChangeStatus;
  rejectionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
};

// Field by field on purpose: the row also holds the storage key of a private document,
// which must never be added to a view by accident.
export function toOwnNameChange(r: NameChangeRequest): OwnNameChange {
  return {
    id: r.id,
    subjectType: r.subjectType,
    fromName: r.fromName,
    toName: r.toName,
    documentKind: r.documentKind,
    status: r.status,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

// What an admin reviewing a request sees. Never a phone number, recipient code or
// storage key; the document opens only through a signed link.
export type AdminNameChange = OwnNameChange & {
  reason: string;
  // The person's email, or the cooperative's registration number.
  subjectLabel: string;
  requesterName: string;
  waitingDays: number;
  canDecide: boolean;
  payoutAccountName: string | null;
  newNameMatchesAccount: boolean | null;
  // For a cooperative rename, so the admin can open its review page.
  cooperativeId: string | null;
};

export type AdminNameChangeExtras = Omit<
  AdminNameChange,
  keyof OwnNameChange | "reason" | "cooperativeId"
>;

export function toAdminNameChange(
  r: NameChangeRequest,
  extras: AdminNameChangeExtras,
): AdminNameChange {
  return {
    ...toOwnNameChange(r),
    reason: r.reason,
    subjectLabel: extras.subjectLabel,
    requesterName: extras.requesterName,
    waitingDays: extras.waitingDays,
    canDecide: extras.canDecide,
    payoutAccountName: extras.payoutAccountName,
    newNameMatchesAccount: extras.newNameMatchesAccount,
    cooperativeId: r.subjectType === "COOPERATIVE" ? r.subjectId : null,
  };
}

// A tile item for a name change waiting for an admin: the name asked for and the date.
export function toNameChangeTileItem(row: { id: string; toName: string; createdAt: Date }): TileItem {
  return { id: row.id, href: `/admin/names/${row.id}`, title: row.toName, date: row.createdAt.toISOString() };
}
