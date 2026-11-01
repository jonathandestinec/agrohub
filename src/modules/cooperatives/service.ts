import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type {
  Cooperative,
  CooperativeDocument,
  DocumentKind,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { putPrivate, signedUrl } from "@/lib/storage";
import { recordAudit } from "@/modules/audit/audit";
import { can, type Actor } from "@/modules/identity/policies";
import {
  ALLOWED_CONTENT_TYPES,
  DOCUMENT_KINDS,
  MAX_DOCUMENT_BYTES,
  createCooperativeInput,
  documentKind,
  type CreateCooperativeInput,
} from "./schema";

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
  file: { kind: DocumentKind; body: Buffer; contentType: string },
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
  // Opaque random id (no new dependency for cuid generation).
  const storageKey = `cooperatives/${cooperativeId}/${file.kind}/${randomBytes(12).toString("hex")}`;
  await putPrivate(storageKey, file.body, file.contentType);
  const document = await prisma.cooperativeDocument.create({
    data: {
      cooperativeId,
      kind: file.kind,
      storageKey,
      contentType: file.contentType,
      sizeBytes: file.body.length,
      uploadedBy: actor.userId,
    },
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
  return document;
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
