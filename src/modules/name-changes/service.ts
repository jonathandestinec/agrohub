import { randomBytes } from "node:crypto";
import {
  Prisma,
  type NameDocumentKind,
  type NameSubjectType,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_BYTES, matchesSignature } from "@/lib/file-type";
import { putPrivate } from "@/lib/storage";
import { recordAudit } from "@/modules/audit/audit";
import { payoutAccountFor } from "@/modules/banking/service";
import {
  PERSON_DOCUMENT_KINDS,
  cleanName,
  cleanRequestReason,
  type NameChangeFile,
  type NameChangeInput,
} from "./schema";
import { toOwnNameChange, type OwnNameChange } from "./views";

export type { OwnNameChange };

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
  if ((await payoutAccountFor(subject, now)).changeOpen) {
    throw new ConflictError(
      "A bank account change is still in progress",
      "BANK_CHANGE_OPEN",
    );
  }
  const pending = await prisma.nameChangeRequest.findFirst({
    where: { subjectType: subject.type, subjectId: subject.id, status: "PENDING" },
    select: { id: true },
  });
  if (pending) throw alreadyPending();

  const storageKey = `name-changes/${subject.type}/${subject.id}/${randomBytes(12).toString("hex")}`;
  await putPrivate(storageKey, file.body, file.contentType);
  try {
    const row = await prisma.$transaction(async (tx) => {
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
