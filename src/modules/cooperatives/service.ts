import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type {
  Cooperative,
  CooperativeDocument,
  CooperativeStatus,
  DocumentKind,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { sendEmail } from "@/lib/email";
import { putPrivate, signedUrl } from "@/lib/storage";
import { recordAudit } from "@/modules/audit/audit";
import { getPlatformSettings } from "@/modules/settings/service";
import { can, type Actor } from "@/modules/identity/policies";
import {
  cooperativeStatusEmail,
  type StatusEmailKind,
} from "@/modules/notifications/emails";
import {
  ALLOWED_CONTENT_TYPES,
  DOCUMENT_KINDS,
  MAX_DOCUMENT_BYTES,
  cooperativeDetailsInput,
  createCooperativeInput,
  documentKind,
  type CooperativeDetailsInput,
  type CreateCooperativeInput,
} from "./schema";
import {
  latestPerKind,
  toAdminCooperative,
  type AdminCooperative,
} from "./views";

export type { Cooperative, CooperativeDocument };

const DOCUMENT_URL_TTL_SECONDS = 300;

class AlreadyOfficer extends ConflictError {
  constructor() {
    super("Already an officer", "ALREADY_OFFICER");
  }
}

// Self-onboarding: the caller has no membership yet, so there is no Actor; scoped to the caller's own userId.
export async function createCooperative(
  user: { userId: string },
  input: CreateCooperativeInput,
): Promise<Cooperative> {
  const parsed = createCooperativeInput.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  let created: { cooperative: Cooperative; membershipId: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const existing = await tx.membership.findFirst({
        where: {
          userId: user.userId,
          role: "OFFICER",
          status: { in: ["PENDING", "ACTIVE"] },
        },
      });
      if (existing) throw new AlreadyOfficer();
      const taken = await tx.cooperative.findUnique({
        where: { registrationNumber: parsed.data.registrationNumber },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictError(
          "Registration number already in use",
          "REGISTRATION_NUMBER_TAKEN",
        );
      }
      const cooperative = await tx.cooperative.create({ data: parsed.data });
      const membership = await tx.membership.create({
        data: {
          userId: user.userId,
          role: "OFFICER",
          cooperativeId: cooperative.id,
          status: "ACTIVE",
        },
      });
      return { cooperative, membershipId: membership.id };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // Lost a race with a concurrent request: the unique indexes are the last line.
      const target = JSON.stringify(error.meta ?? {});
      if (target.includes("registrationNumber")) {
        throw new ConflictError(
          "Registration number already in use",
          "REGISTRATION_NUMBER_TAKEN",
        );
      }
      throw new AlreadyOfficer();
    }
    throw error;
  }
  await recordAudit({
    actorId: user.userId,
    action: "cooperative.create",
    entity: "cooperative",
    entityId: created.cooperative.id,
  });
  await recordAudit({
    actorId: null,
    action: "membership.grant",
    entity: "membership",
    entityId: created.membershipId,
    meta: { role: "OFFICER", status: "ACTIVE" },
  });
  return created.cooperative;
}

// First bytes of each allowed type; the declared contentType alone is not trusted.
const SIGNATURES: Record<(typeof ALLOWED_CONTENT_TYPES)[number], number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46], // %PDF
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
};

function matchesSignature(body: Buffer, contentType: string): boolean {
  const signature = SIGNATURES[contentType as keyof typeof SIGNATURES];
  return (
    signature !== undefined &&
    body.length >= signature.length &&
    signature.every((byte, i) => body[i] === byte)
  );
}

export async function uploadDocument(
  actor: Actor,
  cooperativeId: string,
  file: {
    kind: DocumentKind;
    body: Buffer;
    contentType: string;
    certificateExpiresAt?: Date;
  },
  now: Date = new Date(),
): Promise<CooperativeDocument> {
  if (!can(actor, "cooperative:upload", { cooperativeId })) {
    throw new ForbiddenError();
  }
  if (!documentKind.safeParse(file.kind).success) {
    throw new ValidationError("Unknown document kind", "INVALID_KIND");
  }
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(file.contentType)) {
    throw new ValidationError("File type not allowed", "FILE_TYPE_NOT_ALLOWED");
  }
  if (file.body.length > MAX_DOCUMENT_BYTES) {
    throw new ValidationError("File is too large", "FILE_TOO_LARGE");
  }
  if (!matchesSignature(file.body, file.contentType)) {
    throw new ValidationError(
      "File contents do not match the declared type",
      "FILE_TYPE_MISMATCH",
    );
  }
  // A registration certificate is a renewal (spec 6.1: re-submitted each year), so it
  // must carry its new expiry date. Accepted in any status, and never changes the status:
  // a lapsed cooperative is re-queued by submittedAt below, and a VERIFIED one stays so.
  const renewal = file.kind === "REGISTRATION_CERTIFICATE";
  const expiresAt = file.certificateExpiresAt;
  if (
    renewal &&
    (!(expiresAt instanceof Date) ||
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= now.getTime())
  ) {
    throw new ValidationError(
      "The certificate expiry date must be in the future",
      "CERTIFICATE_EXPIRY_INVALID",
    );
  }
  // Opaque random id (no new dependency for cuid generation).
  const storageKey = `cooperatives/${cooperativeId}/${file.kind}/${randomBytes(12).toString("hex")}`;
  await putPrivate(storageKey, file.body, file.contentType);
  const document = await prisma.$transaction(async (tx) => {
    const created = await tx.cooperativeDocument.create({
      data: {
        cooperativeId,
        kind: file.kind,
        storageKey,
        contentType: file.contentType,
        sizeBytes: file.body.length,
        uploadedBy: actor.userId,
      },
    });
    if (renewal && expiresAt) {
      await tx.cooperative.update({
        where: { id: cooperativeId },
        data: { certificateExpiresAt: expiresAt },
      });
    }
    return created;
  });
  const kinds = await prisma.cooperativeDocument.findMany({
    where: { cooperativeId },
    distinct: ["kind"],
    select: { kind: true },
  });
  if (DOCUMENT_KINDS.every((kind) => kinds.some((row) => row.kind === kind))) {
    // Only while still null, so a re-upload never moves the waiting-since date.
    await prisma.cooperative.updateMany({
      where: { id: cooperativeId, submittedAt: null },
      data: { submittedAt: new Date() },
    });
  }
  await recordAudit({
    actorId: actor.userId,
    action: "cooperative.document.upload",
    entity: "cooperative_document",
    entityId: document.id,
    meta: { kind: file.kind, sizeBytes: file.body.length },
  });
  if (renewal) {
    await recordAudit({
      actorId: actor.userId,
      action: "cooperative.certificate_renewed",
      entity: "cooperative",
      entityId: cooperativeId,
      meta: { cooperativeId, documentId: document.id },
    });
  }
  return document;
}

// Officer correction path while the cooperative is still PENDING (before verification).
export async function updateCooperativeDetails(
  actor: Actor,
  cooperativeId: string,
  input: CooperativeDetailsInput,
): Promise<Cooperative> {
  if (!can(actor, "cooperative:edit", { cooperativeId })) {
    throw new ForbiddenError();
  }
  const parsed = cooperativeDetailsInput.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  const taken = await prisma.cooperative.findFirst({
    where: {
      registrationNumber: parsed.data.registrationNumber,
      id: { not: cooperativeId },
    },
    select: { id: true },
  });
  if (taken) throw registrationNumberTaken();
  let count: number;
  try {
    // Conditional on PENDING, so a concurrent verification cannot be edited past.
    ({ count } = await prisma.cooperative.updateMany({
      where: { id: cooperativeId, status: "PENDING" },
      data: parsed.data,
    }));
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw registrationNumberTaken();
    }
    throw error;
  }
  if (count === 0) {
    await loadForReview(cooperativeId); // NotFoundError when it does not exist
    throw illegalTransition();
  }
  await recordAudit({
    actorId: actor.userId,
    action: "cooperative.edit",
    entity: "cooperative",
    entityId: cooperativeId,
    meta: { cooperativeId },
  });
  return loadForReview(cooperativeId);
}

// The officer sets the cooperative's own cut, in any status, up to the admin maximum. Lots
// already submitted keep the cut they were quoted.
export async function setCooperativeCut(
  actor: Actor,
  cooperativeId: string,
  cutBps: number,
): Promise<{ cutBps: number }> {
  if (!can(actor, "cooperative:edit", { cooperativeId })) {
    throw new ForbiddenError();
  }
  if (!Number.isSafeInteger(cutBps) || cutBps < 0) {
    throw new ValidationError("Cut must be whole basis points", "INVALID_CUT");
  }
  const { maxCooperativeCutBps } = await getPlatformSettings();
  if (cutBps > maxCooperativeCutBps) {
    throw new ValidationError("Cut is above the maximum", "CUT_ABOVE_MAXIMUM");
  }
  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<Array<{ cutBps: number }>>`
      SELECT "cutBps" FROM cooperative WHERE id = ${cooperativeId} FOR UPDATE`;
    if (!row) throw new NotFoundError("COOPERATIVE_NOT_FOUND");
    if (row.cutBps === cutBps) return;
    await tx.cooperative.update({ where: { id: cooperativeId }, data: { cutBps } });
    await recordAudit(
      {
        actorId: actor.userId,
        action: "cooperative.cut",
        entity: "cooperative",
        entityId: cooperativeId,
        meta: { cooperativeId, fromBps: row.cutBps, toBps: cutBps },
      },
      tx,
    );
  });
  return { cutBps };
}

function registrationNumberTaken(): ConflictError {
  return new ConflictError(
    "Registration number already in use",
    "REGISTRATION_NUMBER_TAKEN",
  );
}

// Returns only a short-lived signed link; the file itself is never streamed through the app.
export async function getDocumentUrl(
  actor: Actor,
  documentId: string,
): Promise<string> {
  const document = await prisma.cooperativeDocument.findUnique({
    where: { id: documentId },
  });
  if (!document) throw new NotFoundError("DOCUMENT_NOT_FOUND");
  if (!can(actor, "document:view", { cooperativeId: document.cooperativeId })) {
    throw new ForbiddenError();
  }
  return signedUrl(document.storageKey, DOCUMENT_URL_TTL_SECONDS);
}

export async function getOwnCooperative(
  actor: Actor,
): Promise<{ cooperative: Cooperative; documents: CooperativeDocument[] }> {
  const cooperativeId = actor.cooperativeId;
  if (
    cooperativeId === null ||
    !can(actor, "cooperative:read", { cooperativeId })
  ) {
    throw new ForbiddenError();
  }
  const cooperative = await prisma.cooperative.findUnique({
    where: { id: cooperativeId },
    include: { documents: { orderBy: { createdAt: "asc" } } },
  });
  if (!cooperative) throw new NotFoundError("COOPERATIVE_NOT_FOUND");
  const { documents, ...row } = cooperative;
  return { cooperative: row, documents };
}

// ---- Admin verification ----

const DAY_MS = 86_400_000;
const MAX_REASON_LENGTH = 500;

type Transition = {
  action: "verify" | "reject" | "suspend" | "reinstate";
  email: StatusEmailKind;
  from: CooperativeStatus;
  to: CooperativeStatus;
};

function illegalTransition(): ConflictError {
  return new ConflictError("Illegal status change", "ILLEGAL_TRANSITION");
}

function cleanReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("A reason is required", "REASON_REQUIRED");
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    throw new ValidationError("Reason is too long", "REASON_TOO_LONG");
  }
  return trimmed;
}

function requireAdminAction(
  actor: Actor,
  action: "cooperative:verify" | "cooperative:suspend",
  cooperativeId: string,
): void {
  if (!can(actor, action, { cooperativeId })) throw new ForbiddenError();
}

async function loadForReview(id: string): Promise<Cooperative> {
  const cooperative = await prisma.cooperative.findUnique({ where: { id } });
  if (!cooperative) throw new NotFoundError("COOPERATIVE_NOT_FOUND");
  return cooperative;
}

// Conditional update on the expected status: of two concurrent callers exactly one
// gets count 1, so the audit row and the emails happen once. The audit write cannot
// join this update in a transaction (recordAudit uses the shared client), so it follows it.
async function transition(
  actor: Actor,
  cooperative: Cooperative,
  step: Transition,
  data: Prisma.CooperativeUpdateManyMutationInput,
  extraWhere: Prisma.CooperativeWhereInput,
  reason: string | undefined,
): Promise<Cooperative> {
  const { count } = await prisma.cooperative.updateMany({
    where: { id: cooperative.id, status: step.from, ...extraWhere },
    data,
  });
  if (count === 0) throw illegalTransition();
  await recordAudit({
    actorId: actor.userId,
    action: `cooperative.${step.action}`,
    entity: "cooperative",
    entityId: cooperative.id,
    meta: {
      from: step.from,
      to: step.to,
      ...(reason === undefined ? {} : { reason }),
    },
  });
  await notifyOfficers(cooperative, step.email, reason);
  return loadForReview(cooperative.id);
}

function logEmailFailure(
  cooperativeId: string,
  kind: StatusEmailKind,
  err: unknown,
): void {
  // Never log the recipient, the html or the reason.
  console.error("cooperative status email failed", {
    cooperativeId,
    kind,
    error:
      err instanceof Error
        ? { name: err.name, message: err.message }
        : "non-Error thrown",
  });
}

// Runs after the status change has committed, so nothing here may throw to the caller.
async function notifyOfficers(
  cooperative: Cooperative,
  kind: StatusEmailKind,
  reason: string | undefined,
): Promise<void> {
  try {
    const officers = await prisma.membership.findMany({
      where: {
        cooperativeId: cooperative.id,
        role: "OFFICER",
        status: "ACTIVE",
      },
      select: { user: { select: { email: true } } },
    });
    const { subject, html } = cooperativeStatusEmail(kind, {
      cooperativeName: cooperative.name,
      reason,
    });
    const results = await Promise.allSettled(
      officers.map((officer) =>
        sendEmail({ to: officer.user.email, subject, html }),
      ),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        logEmailFailure(cooperative.id, kind, result.reason);
      }
    }
  } catch (err) {
    logEmailFailure(cooperative.id, kind, err);
  }
}

export async function listVerificationQueue(
  actor: Actor,
  now: Date = new Date(),
): Promise<Array<AdminCooperative & { waitingDays: number }>> {
  if (!can(actor, "cooperative:queue")) throw new ForbiddenError();
  const rows = await prisma.cooperative.findMany({
    where: { status: "PENDING", submittedAt: { not: null } },
    orderBy: { submittedAt: "asc" },
    include: { documents: { orderBy: { createdAt: "asc" } } },
  });
  return rows.map(({ documents, ...row }) => ({
    ...toAdminCooperative(row, latestPerKind(documents), now),
    waitingDays:
      row.submittedAt === null
        ? 0
        : Math.max(
            0,
            Math.floor((now.getTime() - row.submittedAt.getTime()) / DAY_MS),
          ),
  }));
}

export async function getCooperativeForReview(
  actor: Actor,
  id: string,
  now: Date = new Date(),
): Promise<AdminCooperative> {
  if (!can(actor, "cooperative:read", { cooperativeId: id })) {
    throw new ForbiddenError();
  }
  const row = await prisma.cooperative.findUnique({
    where: { id },
    include: { documents: { orderBy: { createdAt: "asc" } } },
  });
  if (!row) throw new NotFoundError("COOPERATIVE_NOT_FOUND");
  const { documents, ...cooperative } = row;
  return toAdminCooperative(cooperative, latestPerKind(documents), now);
}

export async function verifyCooperative(
  actor: Actor,
  id: string,
  now: Date = new Date(),
): Promise<Cooperative> {
  requireAdminAction(actor, "cooperative:verify", id);
  const cooperative = await loadForReview(id);
  if (cooperative.status !== "PENDING") throw illegalTransition();
  if (cooperative.submittedAt === null) {
    throw new ValidationError("Not submitted for review", "NOT_SUBMITTED");
  }
  const documents = await prisma.cooperativeDocument.findMany({
    where: { cooperativeId: id },
    select: { kind: true },
    distinct: ["kind"],
  });
  if (!DOCUMENT_KINDS.every((k) => documents.some((d) => d.kind === k))) {
    throw new ValidationError("Documents are missing", "DOCUMENTS_MISSING");
  }
  if (cooperative.certificateExpiresAt.getTime() <= now.getTime()) {
    throw new ValidationError("Certificate has expired", "CERTIFICATE_EXPIRED");
  }
  return transition(
    actor,
    cooperative,
    { action: "verify", email: "verified", from: "PENDING", to: "VERIFIED" },
    { status: "VERIFIED", verifiedAt: now, reviewNote: null },
    { submittedAt: { not: null } },
    undefined,
  );
}

// `now` is accepted for a uniform signature across the transition functions.
export async function rejectCooperative(
  actor: Actor,
  id: string,
  reason: string,
  now: Date = new Date(),
): Promise<Cooperative> {
  void now;
  requireAdminAction(actor, "cooperative:verify", id);
  const note = cleanReason(reason);
  const cooperative = await loadForReview(id);
  if (cooperative.status !== "PENDING") throw illegalTransition();
  return transition(
    actor,
    cooperative,
    { action: "reject", email: "rejected", from: "PENDING", to: "PENDING" },
    { reviewNote: note, submittedAt: null },
    { submittedAt: { not: null } },
    note,
  );
}

export async function suspendCooperative(
  actor: Actor,
  id: string,
  reason: string,
  now: Date = new Date(),
): Promise<Cooperative> {
  void now;
  requireAdminAction(actor, "cooperative:suspend", id);
  const note = cleanReason(reason);
  const cooperative = await loadForReview(id);
  if (cooperative.status !== "VERIFIED") throw illegalTransition();
  return transition(
    actor,
    cooperative,
    { action: "suspend", email: "suspended", from: "VERIFIED", to: "SUSPENDED" },
    { status: "SUSPENDED" },
    {},
    note,
  );
}

export async function reinstateCooperative(
  actor: Actor,
  id: string,
  now: Date = new Date(),
): Promise<Cooperative> {
  requireAdminAction(actor, "cooperative:suspend", id);
  const cooperative = await loadForReview(id);
  if (cooperative.status !== "SUSPENDED") throw illegalTransition();
  // The same check as verify: a lapsed certificate cannot come back as VERIFIED.
  if (cooperative.certificateExpiresAt.getTime() <= now.getTime()) {
    throw new ValidationError("Certificate has expired", "CERTIFICATE_EXPIRED");
  }
  return transition(
    actor,
    cooperative,
    { action: "reinstate", email: "reinstated", from: "SUSPENDED", to: "VERIFIED" },
    { status: "VERIFIED" },
    {},
    undefined,
  );
}
