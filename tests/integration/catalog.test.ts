import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  createCrop,
  createUnit,
  listActiveCatalog,
  listCatalog,
  renameCrop,
  setCropActive,
  setUnitActive,
} from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { cleanDatabase, createTestUser } from "./helpers";

let board: Actor;
let admin: Actor;

beforeEach(async () => {
  await cleanDatabase();
  const user = await createTestUser({ id: "u-board" });
  board = { userId: user.id, role: "BOARD_ADMIN", cooperativeId: null, twoFactorEnabled: true };
  admin = { userId: user.id, role: "ADMIN", cooperativeId: null, twoFactorEnabled: true };
});

afterAll(async () => {
  await cleanDatabase();
});

describe("crops and units", () => {
  it("creates a crop and audits it", async () => {
    const crop = await createCrop(board, { name: "Maize" });
    expect(crop).toEqual({ id: crop.id, name: "Maize", active: true });
    const audit = await prisma.auditLog.findMany({ where: { action: "crop.create", entityId: crop.id } });
    expect(audit).toHaveLength(1);
  });

  it("refuses a crop or unit name that differs only in case or spaces", async () => {
    await createCrop(board, { name: "Maize" });
    await expect(createCrop(board, { name: "  maize " })).rejects.toMatchObject({
      constructor: ConflictError,
      code: "CROP_EXISTS",
    });
    await createUnit(board, { name: "Bag" });
    await expect(createUnit(board, { name: "bag" })).rejects.toMatchObject({
      code: "UNIT_EXISTS",
    });
  });

  it("normalizes inner whitespace in names", async () => {
    const crop = await createCrop(board, { name: "  Guinea   corn " });
    expect(crop.name).toBe("Guinea corn");
  });

  it("refuses an ADMIN who is not a board admin", async () => {
    await expect(createCrop(admin, { name: "Maize" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listCatalog(admin)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("hides a deactivated crop or unit from the active catalog only", async () => {
    const crop = await createCrop(board, { name: "Maize" });
    const unit = await createUnit(board, { name: "Bag" });
    await setCropActive(board, crop.id, false);
    await setUnitActive(board, unit.id, false);
    expect(await listActiveCatalog()).toEqual({ crops: [], units: [] });
    const all = await listCatalog(board);
    expect(all.crops).toEqual([{ id: crop.id, name: "Maize", active: false }]);
    expect(all.units).toEqual([{ id: unit.id, name: "Bag", active: false }]);
    const audit = await prisma.auditLog.findMany({
      where: {
        action: { in: ["crop.deactivate", "unit.deactivate"] },
        entityId: { in: [crop.id, unit.id] },
      },
    });
    expect(audit).toHaveLength(2);
  });

  it("refuses renaming a crop to another crop's name", async () => {
    await createCrop(board, { name: "Maize" });
    const rice = await createCrop(board, { name: "Rice" });
    await expect(renameCrop(board, rice.id, { name: "MAIZE" })).rejects.toMatchObject({
      code: "CROP_EXISTS",
    });
    const renamed = await renameCrop(board, rice.id, { name: "Paddy rice" });
    expect(renamed.name).toBe("Paddy rice");
  });

  it("returns NotFoundError for an unknown crop", async () => {
    await expect(setCropActive(board, "missing", false)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("sorts lists by name", async () => {
    await createCrop(board, { name: "Yam" });
    await createCrop(board, { name: "cassava" });
    await createCrop(board, { name: "Maize" });
    const { crops } = await listActiveCatalog();
    expect(crops.map((c) => c.name)).toEqual(["cassava", "Maize", "Yam"]);
  });
});

describe("catalog audit rows", () => {
  it("rename_audit_records_old_and_new_names", async () => {
    const crop = await createCrop(board, { name: "Maize" });
    await renameCrop(board, crop.id, { name: "Corn" });
    const [row] = await prisma.auditLog.findMany({ where: { action: "crop.rename", entityId: crop.id } });
    expect(row.meta).toEqual({ from: "Maize", to: "Corn" });
  });

  it("no_op_changes_write_no_audit_row", async () => {
    const crop = await createCrop(board, { name: "Maize" });
    await renameCrop(board, crop.id, { name: " Maize " });
    await setCropActive(board, crop.id, true);
    const rows = await prisma.auditLog.findMany({
      where: { entityId: crop.id, action: { in: ["crop.rename", "crop.activate"] } },
    });
    expect(rows).toEqual([]);
  });
});
