import type { CatalogKind, CatalogRequest } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/audit";
import { can, type Actor } from "@/modules/identity/policies";
import { nameInput, nameKeyOf } from "./schema";
import { createCrop, createUnit, setCropActive, setUnitActive } from "./service";
import {
  toCatalogRequestView,
  type BoardCatalogRequestGroup,
  type CatalogRequestView,
  type OfficerCatalogRequestView,
} from "./views";

const OPEN = ["WITH_OFFICER", "FORWARDED"] as const;
const MAX_OPEN_PER_FARMER = 5;
const REASON_MIN = 3;
const REASON_MAX = 300;

function parseName(name: string): string {
  const parsed = nameInput.safeParse({ name });
  if (!parsed.success) throw new ValidationError("Name must be 1 to 60 characters", "INVALID_NAME");
  return parsed.data.name;
}

function parseKind(kind: string): CatalogKind {
  if (kind !== "CROP" && kind !== "UNIT") throw new ValidationError("Unknown kind", "INVALID_KIND");
  return kind;
}

function parseReason(reason: unknown): string {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length < REASON_MIN || text.length > REASON_MAX) {
    throw new ValidationError("A reason is required", "REASON_REQUIRED");
  }
  return text;
}

function itemDelegate(kind: CatalogKind) {
  return (kind === "CROP" ? prisma.crop : prisma.unit) as unknown as typeof prisma.crop;
}

// Names of the crops and units requests were resolved to, for the views.
async function resolvedNames(rows: CatalogRequest[]): Promise<Map<string, string>> {
  const ids = (kind: CatalogKind) =>
    rows.filter((r) => r.kind === kind && r.resolvedItemId).map((r) => r.resolvedItemId as string);
  const [crops, units] = await Promise.all([
    prisma.crop.findMany({ where: { id: { in: ids("CROP") } }, select: { id: true, name: true } }),
    prisma.unit.findMany({ where: { id: { in: ids("UNIT") } }, select: { id: true, name: true } }),
  ]);
  return new Map([...crops, ...units].map((item) => [item.id, item.name]));
}

async function views(rows: CatalogRequest[]): Promise<CatalogRequestView[]> {
  const names = await resolvedNames(rows);
  return rows.map((row) => toCatalogRequestView(row, names));
}

async function audit(actor: Actor, action: string, row: CatalogRequest, meta: Record<string, unknown> = {}) {
  await recordAudit({
    actorId: actor.userId,
    action: `catalog_request.${action}`,
    entity: "catalog_request",
    entityId: row.id,
    meta: { requestId: row.id, kind: row.kind, cooperativeId: row.cooperativeId, ...meta },
  });
}

// ---- Farmers ----

export async function requestCatalogItem(
  actor: Actor,
  input: { kind: "CROP" | "UNIT"; name: string },
): Promise<CatalogRequestView> {
  const cooperativeId = actor.cooperativeId;
  if (cooperativeId === null || !can(actor, "catalog:request", { cooperativeId })) {
    throw new ForbiddenError();
  }
  const kind = parseKind(input?.kind);
  const name = parseName(typeof input?.name === "string" ? input.name : "");
  const nameKey = nameKeyOf(name);

  const listed = await itemDelegate(kind).findUnique({ where: { nameKey } });
  if (listed?.active) {
    throw new ConflictError("Already listed", kind === "CROP" ? "CROP_EXISTS" : "UNIT_EXISTS");
  }
  const open = await prisma.catalogRequest.findFirst({
    where: { cooperativeId, kind, nameKey, status: { in: [...OPEN] } },
  });
  if (open) return (await views([open]))[0];

  const mine = await prisma.catalogRequest.count({
    where: { requestedByUserId: actor.userId, status: { in: [...OPEN] } },
  });
  if (mine >= MAX_OPEN_PER_FARMER) {
    throw new ValidationError("Too many open requests", "REQUEST_LIMIT");
  }
  const row = await prisma.catalogRequest.create({
    data: { kind, name, nameKey, cooperativeId, requestedByUserId: actor.userId },
  });
  await audit(actor, "create", row);
  return (await views([row]))[0];
}

// The farmer's requests and, through their cooperative, the requests they share with others.
export async function listOwnCatalogRequests(actor: Actor): Promise<CatalogRequestView[]> {
  const cooperativeId = actor.cooperativeId;
  if (cooperativeId === null || !can(actor, "catalog:request", { cooperativeId })) {
    throw new ForbiddenError();
  }
  const rows = await prisma.catalogRequest.findMany({
    where: { requestedByUserId: actor.userId },
    orderBy: { createdAt: "desc" },
  });
  return views(rows);
}

// ---- Officers ----

async function loadForOfficer(actor: Actor, id: string): Promise<CatalogRequest> {
  const cooperativeId = actor.cooperativeId;
  if (cooperativeId === null || !can(actor, "catalog:forward", { cooperativeId })) {
    throw new ForbiddenError();
  }
  const row = await prisma.catalogRequest.findUnique({ where: { id } });
  // Another cooperative's request is "not found", so ids cannot be probed.
  if (!row || row.cooperativeId !== cooperativeId) throw new NotFoundError("REQUEST_NOT_FOUND");
  return row;
}

// Moves a request on from WITH_OFFICER; a concurrent decision makes this one REQUEST_NOT_OPEN.
async function decideAsOfficer(
  actor: Actor,
  id: string,
  data: Partial<CatalogRequest>,
  action: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const row = await loadForOfficer(actor, id);
  const { count } = await prisma.catalogRequest.updateMany({
    where: { id, status: "WITH_OFFICER" },
    data,
  });
  if (count === 0) throw new ConflictError("Request is not open", "REQUEST_NOT_OPEN");
  await audit(actor, action, row, meta);
}

export async function listCooperativeCatalogRequests(actor: Actor): Promise<OfficerCatalogRequestView[]> {
  const cooperativeId = actor.cooperativeId;
  if (cooperativeId === null || !can(actor, "catalog:forward", { cooperativeId })) {
    throw new ForbiddenError();
  }
  const rows = await prisma.catalogRequest.findMany({
    where: { cooperativeId, status: "WITH_OFFICER" },
    orderBy: { createdAt: "asc" },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.requestedByUserId) } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return (await views(rows)).map((view, i) => ({
    ...view,
    farmerName: names.get(rows[i].requestedByUserId) ?? "",
  }));
}

export async function forwardCatalogRequest(actor: Actor, id: string): Promise<void> {
  await decideAsOfficer(actor, id, { status: "FORWARDED", forwardedByUserId: actor.userId }, "forward");
}

export async function declineCatalogRequestAsOfficer(
  actor: Actor,
  id: string,
  input: { reason: string },
): Promise<void> {
  const reason = parseReason(input?.reason);
  await decideAsOfficer(
    actor,
    id,
    { status: "DECLINED", declineReason: reason, declinedBy: "OFFICER", decidedByUserId: actor.userId },
    "decline",
  );
}

// "That is already listed as Sorghum": closes the request against an active item of its kind.
export async function matchCatalogRequest(actor: Actor, id: string, itemId: string): Promise<void> {
  const row = await loadForOfficer(actor, id);
  const item = await itemDelegate(row.kind).findUnique({ where: { id: itemId } });
  if (!item?.active) throw new NotFoundError("ITEM_NOT_FOUND");
  await decideAsOfficer(
    actor,
    id,
    { status: "APPROVED", resolvedItemId: item.id, decidedByUserId: actor.userId },
    "match",
    { itemId: item.id },
  );
}

// ---- Board admins ----

function assertBoard(actor: Actor): void {
  if (!can(actor, "catalog:manage")) throw new ForbiddenError();
}

async function loadForwarded(id: string): Promise<CatalogRequest> {
  const row = await prisma.catalogRequest.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("REQUEST_NOT_FOUND");
  if (row.status !== "FORWARDED") throw new ConflictError("Request is not open", "REQUEST_NOT_OPEN");
  return row;
}

// Forwarded requests grouped by kind and name, oldest group first.
export async function listForwardedCatalogRequests(actor: Actor): Promise<BoardCatalogRequestGroup[]> {
  assertBoard(actor);
  const rows = await prisma.catalogRequest.findMany({
    where: { status: "FORWARDED" },
    orderBy: { createdAt: "asc" },
    include: { cooperative: { select: { name: true } } },
  });
  const groups = new Map<string, BoardCatalogRequestGroup>();
  for (const row of rows) {
    const key = `${row.kind}:${row.nameKey}`;
    const group = groups.get(key);
    if (group) {
      group.requestIds.push(row.id);
      if (!group.cooperativeNames.includes(row.cooperative.name)) {
        group.cooperativeNames.push(row.cooperative.name);
      }
    } else {
      groups.set(key, {
        id: row.id,
        kind: row.kind,
        name: row.name,
        requestIds: [row.id],
        cooperativeNames: [row.cooperative.name],
        since: row.createdAt.toISOString(),
      });
    }
  }
  return [...groups.values()];
}

// Adds the item (or reactivates it) and approves every open request for that kind and name,
// from any cooperative. The board admin may correct the spelling.
export async function approveCatalogRequest(
  actor: Actor,
  id: string,
  input: { name?: string },
): Promise<void> {
  assertBoard(actor);
  const row = await loadForwarded(id);
  const name = parseName(input?.name === undefined || input.name.trim() === "" ? row.name : input.name);

  const existing = await itemDelegate(row.kind).findUnique({ where: { nameKey: nameKeyOf(name) } });
  let itemId: string;
  if (existing) {
    itemId = existing.id;
    if (!existing.active) {
      await (row.kind === "CROP" ? setCropActive : setUnitActive)(actor, existing.id, true);
    }
  } else {
    itemId = (await (row.kind === "CROP" ? createCrop : createUnit)(actor, { name })).id;
  }

  await prisma.$transaction(async (tx) => {
    const open = await tx.catalogRequest.findMany({
      where: { kind: row.kind, nameKey: row.nameKey, status: { in: [...OPEN] } },
    });
    await tx.catalogRequest.updateMany({
      where: { id: { in: open.map((r) => r.id) }, status: { in: [...OPEN] } },
      data: { status: "APPROVED", resolvedItemId: itemId, decidedByUserId: actor.userId },
    });
    for (const request of open) {
      await recordAudit(
        {
          actorId: actor.userId,
          action: "catalog_request.approve",
          entity: "catalog_request",
          entityId: request.id,
          meta: { requestId: request.id, kind: request.kind, itemId },
        },
        tx,
      );
    }
  });
}

export async function declineCatalogRequest(
  actor: Actor,
  id: string,
  input: { reason: string },
): Promise<void> {
  assertBoard(actor);
  const reason = parseReason(input?.reason);
  const row = await loadForwarded(id);
  const { count } = await prisma.catalogRequest.updateMany({
    where: { id, status: "FORWARDED" },
    data: { status: "DECLINED", declineReason: reason, declinedBy: "BOARD_ADMIN", decidedByUserId: actor.userId },
  });
  if (count === 0) throw new ConflictError("Request is not open", "REQUEST_NOT_OPEN");
  await audit(actor, "decline", row);
}
