import { randomBytes } from "node:crypto";
import {
  Prisma,
  type NameChangeRequest,
  type NameDocumentKind,
  type NameSubjectType,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_BYTES, matchesSignature } from "@/lib/file-type";
import { putPrivate, signedUrl } from "@/lib/storage";
import { lockNameSubject } from "@/lib/subject-lock";
import { recordAudit } from "@/modules/audit/audit";
import { namesMatch, payoutAccountFor } from "@/modules/banking/service";
import { can, type Actor, type Resource } from "@/modules/identity/policies";
import { activeAdmins, notify, officersOf, person } from "@/modules/notifications/service";
import {
  COOPERATIVE_DOCUMENT_KINDS,
  PERSON_DOCUMENT_KINDS,
  cleanName,
  cleanRejectionReason,
  cleanRequestReason,
  type NameChangeFile,
  type NameChangeInput,
} from "./schema";
import {
  toAdminNameChange,
  toOwnNameChange,
  type AdminNameChange,
  type OwnNameChange,
} from "./views";

export type { AdminNameChange, OwnNameChange };

type Subject = { type: NameSubjectType; id: string };

function alreadyPending(): ConflictError {
  return new ConflictError("A name change is already waiting", "NAME_CHANGE_ALREADY_PENDING");
}

function notPending(): ConflictError {
  return new ConflictError("This request is no longer waiting", "NAME_CHANGE_NOT_PENDING");
}

function checkFile(file: NameChangeFile, kinds: readonly NameDocumentKind[]): void {
  if (!kinds.includes(file.kind)) {
    throw new ValidationError("This document is not accepted here", "INVALID_DOCUMENT_KIND");
  }
  if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(file.contentType)) {
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
}

// The shared request path. Callers have authorised `requestedBy` for this subject and
// pass the subject's current name. Everything cheap is checked before the upload; the
// partial unique index is the last line against two requests racing.
async function createRequest(
  subject: Subject,
  currentName: string,
  kinds: readonly NameDocumentKind[],
  requestedBy: string,
  input: NameChangeInput,
  file: NameChangeFile,
  now: Date,
): Promise<OwnNameChange> {
  const toName = cleanName(input?.newName);
  const reason = cleanRequestReason(input?.reason);
  checkFile(file, kinds);
  if (toName === currentName.trim().replace(/\s+/g, " ")) {
    throw new ValidationError("That is already the name", "NAME_UNCHANGED");
  }
  await refuseWhileBankChangeOpen(subject, now);
  const pending = await prisma.nameChangeRequest.findFirst({
    where: { subjectType: subject.type, subjectId: subject.id, status: "PENDING" },
    select: { id: true },
  });
  if (pending) throw alreadyPending();

  const storageKey = `name-changes/${subject.type}/${subject.id}/${randomBytes(12).toString("hex")}`;
  await putPrivate(storageKey, file.body, file.contentType);
  try {
    const row = await prisma.$transaction(async (tx) => {
      // Checked again under the subject's lock, which bank changes take too, so a bank
      // change cannot start between the check and this insert.
      await lockNameSubject(tx, subject);
      await refuseWhileBankChangeOpen(subject, now);
      const created = await tx.nameChangeRequest.create({
        data: {
          subjectType: subject.type,
          subjectId: subject.id,
          fromName: currentName,
          toName,
          reason,
          documentKind: file.kind,
          storageKey,
          contentType: file.contentType,
          sizeBytes: file.body.length,
          requestedByUserId: requestedBy,
          createdAt: now,
        },
      });
      await recordAudit(
        {
          actorId: requestedBy,
          action: "name_change.request",
          entity: "name_change_request",
          entityId: created.id,
          meta: {
            requestId: created.id,
            subjectType: subject.type,
            subjectId: subject.id,
            documentKind: file.kind,
          },
        },
        tx,
      );
      await notify(tx, {
        kind: "NAME_CHANGE_REQUESTED",
        subject: { type: "NAME_CHANGE", id: created.id },
        data: {},
        to: await activeAdmins(tx),
        exclude: requestedBy,
      });
      return created;
    });
    return toOwnNameChange(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw alreadyPending();
    }
    throw error;
  }
}

// Reads through the shared client: called with the subject's lock held, it sees every
// bank change committed under that lock.
async function refuseWhileBankChangeOpen(subject: Subject, now: Date): Promise<void> {
  if ((await payoutAccountFor(subject, now)).changeOpen) {
    throw new ConflictError("A bank account change is still in progress", "BANK_CHANGE_OPEN");
  }
}

async function newestFor(subject: Subject): Promise<OwnNameChange | null> {
  const row = await prisma.nameChangeRequest.findFirst({
    where: { subjectType: subject.type, subjectId: subject.id },
    orderBy: { createdAt: "desc" },
  });
  return row ? toOwnNameChange(row) : null;
}

async function withdraw(
  subject: Subject,
  requestId: string,
  actorId: string,
  now: Date,
): Promise<OwnNameChange> {
  const { count } = await prisma.nameChangeRequest.updateMany({
    where: {
      id: requestId,
      subjectType: subject.type,
      subjectId: subject.id,
      status: "PENDING",
    },
    data: { status: "WITHDRAWN", decidedAt: now },
  });
  if (count === 0) throw notPending();
  await recordAudit({
    actorId,
    action: "name_change.withdraw",
    entity: "name_change_request",
    entityId: requestId,
    meta: { requestId, subjectType: subject.type, subjectId: subject.id },
  });
  return toOwnNameChange(
    await prisma.nameChangeRequest.findUniqueOrThrow({ where: { id: requestId } }),
  );
}

// ---- A person's own name ----

// Self-scoped like setOwnFarmerBankAccount: a PENDING farmer has no Actor yet, so these
// take the signed-in user's id and only ever touch that user's own requests.
export async function requestOwnNameChange(
  user: { userId: string },
  input: NameChangeInput,
  file: NameChangeFile,
  now: Date = new Date(),
): Promise<OwnNameChange> {
  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { name: true },
  });
  if (!row) throw new NotFoundError("USER_NOT_FOUND");
  return createRequest(
    { type: "USER", id: user.userId },
    row.name,
    PERSON_DOCUMENT_KINDS,
    user.userId,
    input,
    file,
    now,
  );
}

// Self-scoped, for /account/name: the caller's current name and their newest request.
export async function getOwnNameState(
  user: { userId: string },
): Promise<{ name: string; request: OwnNameChange | null }> {
  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { name: true },
  });
  if (!row) throw new NotFoundError("USER_NOT_FOUND");
  return { name: row.name, request: await getOwnNameChange(user) };
}

// Self-scoped: the caller's own newest request, any status.
export async function getOwnNameChange(user: { userId: string }): Promise<OwnNameChange | null> {
  return newestFor({ type: "USER", id: user.userId });
}

// Self-scoped: another user's request id looks the same as a decided one, so ids cannot
// be probed.
export async function withdrawOwnNameChange(
  user: { userId: string },
  requestId: string,
  now: Date = new Date(),
): Promise<OwnNameChange> {
  return withdraw({ type: "USER", id: user.userId }, requestId, user.userId, now);
}

// ---- A verified cooperative's name ----

// A PENDING cooperative is still corrected directly (updateCooperativeDetails); once
// verified, its name changes only through an approved request.
export async function requestCooperativeRename(
  actor: Actor,
  cooperativeId: string,
  input: NameChangeInput,
  file: NameChangeFile,
  now: Date = new Date(),
): Promise<OwnNameChange> {
  if (!can(actor, "cooperative:rename", { cooperativeId })) throw new ForbiddenError();
  const cooperative = await prisma.cooperative.findUnique({
    where: { id: cooperativeId },
    select: { name: true, status: true },
  });
  if (!cooperative) throw new NotFoundError("COOPERATIVE_NOT_FOUND");
  if (cooperative.status === "PENDING") {
    throw new ValidationError(
      "Edit the name directly until the cooperative is verified",
      "COOPERATIVE_NOT_VERIFIED",
    );
  }
  return createRequest(
    { type: "COOPERATIVE", id: cooperativeId },
    cooperative.name,
    COOPERATIVE_DOCUMENT_KINDS,
    actor.userId,
    input,
    file,
    now,
  );
}

export async function getCooperativeRename(
  actor: Actor,
  cooperativeId: string,
): Promise<OwnNameChange | null> {
  if (!can(actor, "cooperative:read", { cooperativeId })) throw new ForbiddenError();
  return newestFor({ type: "COOPERATIVE", id: cooperativeId });
}

export async function withdrawCooperativeRename(
  actor: Actor,
  cooperativeId: string,
  requestId: string,
  now: Date = new Date(),
): Promise<OwnNameChange> {
  if (!can(actor, "cooperative:rename", { cooperativeId })) throw new ForbiddenError();
  return withdraw({ type: "COOPERATIVE", id: cooperativeId }, requestId, actor.userId, now);
}

// ---- Admin review and decisions ----

const DAY_MS = 86_400_000;
const DOCUMENT_URL_TTL_SECONDS = 300;

function notFound(): NotFoundError {
  return new NotFoundError("NAME_CHANGE_NOT_FOUND");
}

// Who the request belongs to, for name:decide. For a person the subject is the requester,
// so an admin can never decide a rename of themselves. For a cooperative, any membership
// (any role, any status) of the admin in that cooperative counts as involvement.
async function decisionResource(actor: Actor, request: NameChangeRequest): Promise<Resource> {
  let actorInCooperative: boolean;
  if (request.subjectType === "USER") {
    actorInCooperative = request.subjectId === actor.userId;
  } else {
    const membership = await prisma.membership.findFirst({
      where: { userId: actor.userId, cooperativeId: request.subjectId },
      select: { id: true },
    });
    actorInCooperative = membership !== null;
  }
  return { ownerUserId: request.requestedByUserId, actorInCooperative };
}

// An admin refused only by their own involvement gets a code the screen can explain.
async function requireDecision(actor: Actor, request: NameChangeRequest): Promise<void> {
  if (can(actor, "name:decide", await decisionResource(actor, request))) return;
  if (can(actor, "name:queue")) throw new ForbiddenError("CANNOT_DECIDE_OWN_NAME_CHANGE");
  throw new ForbiddenError();
}

async function loadRequest(requestId: string): Promise<NameChangeRequest> {
  if (typeof requestId !== "string" || requestId === "") throw notFound();
  const row = await prisma.nameChangeRequest.findUnique({ where: { id: requestId } });
  if (!row) throw notFound();
  return row;
}

async function adminView(actor: Actor, row: NameChangeRequest, now: Date): Promise<AdminNameChange> {
  const requester = await prisma.user.findUnique({
    where: { id: row.requestedByUserId },
    select: { name: true },
  });
  let subjectLabel: string;
  if (row.subjectType === "USER") {
    const subject = await prisma.user.findUnique({
      where: { id: row.subjectId },
      select: { email: true },
    });
    subjectLabel = subject?.email ?? "";
  } else {
    const cooperative = await prisma.cooperative.findUnique({
      where: { id: row.subjectId },
      select: { registrationNumber: true },
    });
    subjectLabel = cooperative?.registrationNumber ?? "";
  }
  const account = await payoutAccountFor({ type: row.subjectType, id: row.subjectId }, now);
  return toAdminNameChange(row, {
    subjectLabel,
    requesterName: requester?.name ?? "",
    waitingDays: Math.max(0, Math.floor((now.getTime() - row.createdAt.getTime()) / DAY_MS)),
    canDecide: can(actor, "name:decide", await decisionResource(actor, row)),
    payoutAccountName: account.accountName,
    newNameMatchesAccount:
      account.accountName === null ? null : namesMatch(row.toName, account.accountName),
  });
}

export async function listNameChangeQueue(
  actor: Actor,
  now: Date = new Date(),
): Promise<AdminNameChange[]> {
  if (!can(actor, "name:queue")) throw new ForbiddenError();
  const rows = await prisma.nameChangeRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
  return Promise.all(rows.map((row) => adminView(actor, row, now)));
}

export async function getNameChangeForReview(
  actor: Actor,
  requestId: string,
  now: Date = new Date(),
): Promise<AdminNameChange> {
  if (!can(actor, "name:queue")) throw new ForbiddenError();
  return adminView(actor, await loadRequest(requestId), now);
}

// Returns only a short-lived signed link; the file is never streamed through the app.
export async function getNameChangeDocumentUrl(actor: Actor, requestId: string): Promise<string> {
  if (!can(actor, "name:queue")) throw new ForbiddenError();
  const row = await loadRequest(requestId);
  return signedUrl(row.storageKey, DOCUMENT_URL_TTL_SECONDS);
}

function decisionAudit(actor: Actor, request: NameChangeRequest, action: string) {
  // Ids only: the names and any reason stay on the request row.
  return {
    actorId: actor.userId,
    action,
    entity: "name_change_request",
    entityId: request.id,
    meta: { requestId: request.id, subjectType: request.subjectType, subjectId: request.subjectId },
  };
}

// A personal rename is the person's own alert (no role); a cooperative's goes to its officers.
async function tellRequester(
  tx: Prisma.TransactionClient,
  request: NameChangeRequest,
  kind: "NAME_CHANGE_APPROVED" | "NAME_CHANGE_REJECTED",
  actorId: string,
): Promise<void> {
  await notify(tx, {
    kind,
    subject: { type: "NAME_CHANGE", id: request.id },
    data: {},
    to:
      request.subjectType === "USER"
        ? [person(request.requestedByUserId)]
        : await officersOf(tx, request.subjectId),
    exclude: actorId,
  });
}

// Changes the name only: the payout account (recipient code, account name, bank name) is
// never touched, so the next bank change is checked against the new name.
export async function approveNameChange(
  actor: Actor,
  requestId: string,
  now: Date = new Date(),
): Promise<AdminNameChange> {
  const request = await loadRequest(requestId);
  await requireDecision(actor, request);
  await prisma.$transaction(async (tx) => {
    // Never rename while a bank change for this subject is still in flight.
    const subject = { type: request.subjectType, id: request.subjectId };
    await lockNameSubject(tx, subject);
    await refuseWhileBankChangeOpen(subject, now);
    const { count } = await tx.nameChangeRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "APPROVED", decidedByUserId: actor.userId, decidedAt: now },
    });
    if (count === 0) throw notPending();
    if (request.subjectType === "USER") {
      await tx.user.update({ where: { id: request.subjectId }, data: { name: request.toName } });
    } else {
      await tx.cooperative.update({
        where: { id: request.subjectId },
        data: { name: request.toName },
      });
    }
    await recordAudit(decisionAudit(actor, request, "name_change.approve"), tx);
    await tellRequester(tx, request, "NAME_CHANGE_APPROVED", actor.userId);
  });
  return adminView(actor, await loadRequest(request.id), now);
}

export async function rejectNameChange(
  actor: Actor,
  requestId: string,
  input: { reason: string },
  now: Date = new Date(),
): Promise<AdminNameChange> {
  const request = await loadRequest(requestId);
  await requireDecision(actor, request);
  const reason = cleanRejectionReason(input?.reason);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.nameChangeRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: {
        status: "REJECTED",
        rejectionReason: reason,
        decidedByUserId: actor.userId,
        decidedAt: now,
      },
    });
    if (count === 0) throw notPending();
    await recordAudit(decisionAudit(actor, request, "name_change.reject"), tx);
    await tellRequester(tx, request, "NAME_CHANGE_REJECTED", actor.userId);
  });
  return adminView(actor, await loadRequest(request.id), now);
}

export { nameChangeQueueSummary } from "./summaries";
