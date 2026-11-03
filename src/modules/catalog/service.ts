import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/audit";
import { can, type Actor } from "@/modules/identity/policies";
import { nameInput, nameKeyOf, type NameInput } from "./schema";
import { toCatalogItem, type CatalogItem } from "./views";

export type { CatalogItem };

type Kind = "crop" | "unit";

const EXISTS_CODE: Record<Kind, string> = { crop: "CROP_EXISTS", unit: "UNIT_EXISTS" };
const NOT_FOUND_CODE: Record<Kind, string> = { crop: "CROP_NOT_FOUND", unit: "UNIT_NOT_FOUND" };

function assertCanManage(actor: Actor): void {
  if (!can(actor, "catalog:manage")) throw new ForbiddenError();
}

function parseName(input: NameInput): string {
  const parsed = nameInput.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Name must be 1 to 60 characters", "INVALID_NAME");
  }
  return parsed.data.name;
}

// Crop and Unit share one shape, so one delegate per kind serves both.
function delegate(kind: Kind) {
  return (kind === "crop" ? prisma.crop : prisma.unit) as unknown as typeof prisma.crop;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function create(actor: Actor, kind: Kind, input: NameInput): Promise<CatalogItem> {
  assertCanManage(actor);
  const name = parseName(input);
  try {
    const row = await delegate(kind).create({ data: { name, nameKey: nameKeyOf(name) } });
    await recordAudit({ actorId: actor.userId, action: `${kind}.create`, entity: kind, entityId: row.id });
    return toCatalogItem(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`${kind} exists`, EXISTS_CODE[kind]);
    throw error;
  }
}

// Applies one change and its audit row together. A change that alters nothing writes
// nothing, so the audit log holds only real changes.
async function update(
  actor: Actor,
  kind: Kind,
  id: string,
  change: (existing: CatalogItem) => {
    data: { name: string; nameKey: string } | { active: boolean };
    action: string;
    meta?: Record<string, unknown>;
  } | null,
): Promise<CatalogItem> {
  const existing = await delegate(kind).findUnique({ where: { id } });
  if (!existing) throw new NotFoundError(NOT_FOUND_CODE[kind]);
  const planned = change(toCatalogItem(existing));
  if (!planned) return toCatalogItem(existing);
  try {
    return await prisma.$transaction(async (tx) => {
      const client = (kind === "crop" ? tx.crop : tx.unit) as unknown as typeof tx.crop;
      const row = await client.update({ where: { id }, data: planned.data });
      await recordAudit(
        { actorId: actor.userId, action: planned.action, entity: kind, entityId: id, meta: planned.meta },
        tx,
      );
      return toCatalogItem(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`${kind} exists`, EXISTS_CODE[kind]);
    throw error;
  }
}

async function rename(actor: Actor, kind: Kind, id: string, input: NameInput): Promise<CatalogItem> {
  assertCanManage(actor);
  const name = parseName(input);
  // Names are not personal data, so the audit row keeps both.
  return update(actor, kind, id, (existing) =>
    existing.name === name
      ? null
      : {
          data: { name, nameKey: nameKeyOf(name) },
          action: `${kind}.rename`,
          meta: { from: existing.name, to: name },
        },
  );
}

async function setActive(actor: Actor, kind: Kind, id: string, active: boolean): Promise<CatalogItem> {
  assertCanManage(actor);
  return update(actor, kind, id, (existing) =>
    existing.active === active
      ? null
      : { data: { active }, action: `${kind}.${active ? "activate" : "deactivate"}` },
  );
}

export const createCrop = (actor: Actor, input: NameInput) => create(actor, "crop", input);
export const renameCrop = (actor: Actor, id: string, input: NameInput) => rename(actor, "crop", id, input);
export const setCropActive = (actor: Actor, id: string, active: boolean) =>
  setActive(actor, "crop", id, active);
export const createUnit = (actor: Actor, input: NameInput) => create(actor, "unit", input);
export const renameUnit = (actor: Actor, id: string, input: NameInput) => rename(actor, "unit", id, input);
export const setUnitActive = (actor: Actor, id: string, active: boolean) =>
  setActive(actor, "unit", id, active);

async function list(where: { active?: boolean }) {
  const [crops, units] = await Promise.all([
    prisma.crop.findMany({ where, orderBy: { nameKey: "asc" } }),
    prisma.unit.findMany({ where, orderBy: { nameKey: "asc" } }),
  ]);
  return { crops: crops.map(toCatalogItem), units: units.map(toCatalogItem) };
}

// Every crop and unit, active or not, for the board admin's list.
export async function listCatalog(
  actor: Actor,
): Promise<{ crops: CatalogItem[]; units: CatalogItem[] }> {
  assertCanManage(actor);
  return list({});
}

// Public reference data for forms and the price board: no Actor, because the lists hold
// no private fields and signed-out visitors read the board.
export async function listActiveCatalog(): Promise<{ crops: CatalogItem[]; units: CatalogItem[] }> {
  return list({ active: true });
}

export {
  approveCatalogRequest,
  declineCatalogRequest,
  declineCatalogRequestAsOfficer,
  forwardCatalogRequest,
  listCooperativeCatalogRequests,
  listForwardedCatalogRequests,
  listOwnCatalogRequests,
  matchCatalogRequest,
  requestCatalogItem,
} from "./requests";
export type {
  BoardCatalogRequestGroup,
  CatalogRequestView,
  OfficerCatalogRequestView,
} from "./views";
