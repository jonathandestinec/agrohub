import type {
  Cooperative,
  CooperativeDocument,
  CooperativeStatus,
  DocumentKind,
} from "@/generated/prisma/client";

const DAY_MS = 86_400_000;

export type OfficerCooperative = {
  id: string;
  name: string;
  registrationNumber: string;
  state: string;
  lga: string;
  status: CooperativeStatus;
  certificateExpiresAt: string;
  submittedAt: string | null;
  cutBps: number;
};

export type DocumentSummary = {
  id: string;
  kind: DocumentKind;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};

export type AdminCooperative = OfficerCooperative & {
  verifiedAt: string | null;
  reviewNote: string | null;
  waitingDays: number | null;
  documents: DocumentSummary[];
};

// Field by field on purpose: Cooperative rows also hold bank data (recipientCode,
// accountName) that must never be added to a view by accident.
export function toOfficerCooperative(c: Cooperative): OfficerCooperative {
  return {
    id: c.id,
    name: c.name,
    registrationNumber: c.registrationNumber,
    state: c.state,
    lga: c.lga,
    status: c.status,
    certificateExpiresAt: c.certificateExpiresAt.toISOString(),
    submittedAt: c.submittedAt?.toISOString() ?? null,
    cutBps: c.cutBps,
  };
}

export function toDocumentSummary(d: CooperativeDocument): DocumentSummary {
  return {
    id: d.id,
    kind: d.kind,
    contentType: d.contentType,
    sizeBytes: d.sizeBytes,
    createdAt: d.createdAt.toISOString(),
  };
}

export function toAdminCooperative(
  c: Cooperative,
  docs: CooperativeDocument[],
  now: Date = new Date(),
): AdminCooperative {
  return {
    ...toOfficerCooperative(c),
    verifiedAt: c.verifiedAt?.toISOString() ?? null,
    reviewNote: c.reviewNote,
    waitingDays: c.submittedAt
      ? Math.max(0, Math.floor((now.getTime() - c.submittedAt.getTime()) / DAY_MS))
      : null,
    documents: docs.map(toDocumentSummary),
  };
}

// What an officer sees of their own cooperative: the review note explains a rejection.
export type OwnCooperative = OfficerCooperative & { reviewNote: string | null };

export function toOwnCooperative(c: Cooperative): OwnCooperative {
  return { ...toOfficerCooperative(c), reviewNote: c.reviewNote };
}

// Uploads are kept as history; reviewers and checks only care about the newest per kind.
export function latestPerKind(
  docs: CooperativeDocument[],
): CooperativeDocument[] {
  const latest = new Map<DocumentKind, CooperativeDocument>();
  for (const doc of docs) {
    const current = latest.get(doc.kind);
    if (!current || doc.createdAt.getTime() >= current.createdAt.getTime()) {
      latest.set(doc.kind, doc);
    }
  }
  return [...latest.values()];
}
