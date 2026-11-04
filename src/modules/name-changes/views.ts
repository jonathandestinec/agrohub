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
