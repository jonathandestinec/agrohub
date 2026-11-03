import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  approveCatalogRequest,
  createCrop,
  createUnit,
  declineCatalogRequest,
  declineCatalogRequestAsOfficer,
  forwardCatalogRequest,
  listActiveCatalog,
  listCooperativeCatalogRequests,
  listForwardedCatalogRequests,
  listOwnCatalogRequests,
  matchCatalogRequest,
  requestCatalogItem,
  setCropActive,
} from "@/modules/catalog/service";
import { updateOwnCrops } from "@/modules/farmers/service";
import type { Actor } from "@/modules/identity/policies";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

let board: Actor;
let admin: Actor;
let coopA: string;
let coopB: string;
let officerA: Actor;
let officerB: Actor;

async function farmer(userId: string, cooperativeId: string): Promise<Actor> {
  await createTestUser({ id: userId, name: `Farmer ${userId}` });
  await prisma.membership.create({
    data: { userId, role: "FARMER", cooperativeId, status: "ACTIVE" },
  });
  await prisma.farmerProfile.create({
    data: { userId, cooperativeId, farmSizeHectares: "1", state: "Kaduna", lga: "Zaria" },
  });
  return { userId, role: "FARMER", cooperativeId, twoFactorEnabled: false };
}

beforeEach(async () => {
  await cleanDatabase();
  coopA = (await createTestCooperative({ name: "Coop A", status: "VERIFIED" })).id;
  coopB = (await createTestCooperative({ name: "Coop B", status: "VERIFIED" })).id;
  await createTestUser({ id: "u-board" });
  board = { userId: "u-board", role: "BOARD_ADMIN", cooperativeId: null, twoFactorEnabled: true };
  admin = { userId: "u-board", role: "ADMIN", cooperativeId: null, twoFactorEnabled: true };
  await createTestUser({ id: "u-officer-a" });
  officerA = { userId: "u-officer-a", role: "OFFICER", cooperativeId: coopA, twoFactorEnabled: false };
  officerB = { userId: "u-officer-a", role: "OFFICER", cooperativeId: coopB, twoFactorEnabled: false };
});

afterAll(async () => {
  await cleanDatabase();
});

describe("farmers ask for a missing crop or unit", () => {
  it("creates one request per cooperative and name, with an audit row", async () => {
    const f1 = await farmer("u-f1", coopA);
    const f2 = await farmer("u-f2", coopA);
    const f3 = await farmer("u-f3", coopB);
    const first = await requestCatalogItem(f1, { kind: "CROP", name: "Tiger nut" });
    expect(first).toMatchObject({ kind: "CROP", name: "Tiger nut", status: "WITH_OFFICER" });
    const audit = await prisma.auditLog.findMany({
      where: { action: "catalog_request.create", entityId: first.id },
    });
    expect(audit).toHaveLength(1);

    expect((await requestCatalogItem(f1, { kind: "CROP", name: " tiger  NUT " })).id).toBe(first.id);
    expect((await requestCatalogItem(f2, { kind: "CROP", name: "Tiger nut" })).id).toBe(first.id);
    expect((await requestCatalogItem(f3, { kind: "CROP", name: "Tiger nut" })).id).not.toBe(first.id);
    expect(await prisma.catalogRequest.count()).toBe(2);
  });

  it("refuses a name that is already active, but accepts a deactivated one", async () => {
    const f1 = await farmer("u-f1", coopA);
    const maize = await createCrop(board, { name: "Maize" });
    await createUnit(board, { name: "Bag" });
    await expect(requestCatalogItem(f1, { kind: "CROP", name: "maize" })).rejects.toMatchObject({
      constructor: ConflictError,
      code: "CROP_EXISTS",
    });
    await expect(requestCatalogItem(f1, { kind: "UNIT", name: "BAG" })).rejects.toMatchObject({
      code: "UNIT_EXISTS",
    });
    await setCropActive(board, maize.id, false);
    await expect(requestCatalogItem(f1, { kind: "CROP", name: "Maize" })).resolves.toMatchObject({
      status: "WITH_OFFICER",
    });
  });

  it("limits a farmer to 5 open requests", async () => {
    const f1 = await farmer("u-f1", coopA);
    for (let i = 0; i < 5; i++) await requestCatalogItem(f1, { kind: "CROP", name: `Crop ${i}` });
    await expect(requestCatalogItem(f1, { kind: "UNIT", name: "Mudu" })).rejects.toMatchObject({
      constructor: ValidationError,
      code: "REQUEST_LIMIT",
    });
  });

  it("refuses a blank name and anyone but a farmer", async () => {
    const f1 = await farmer("u-f1", coopA);
    await expect(requestCatalogItem(f1, { kind: "CROP", name: "  " })).rejects.toMatchObject({
      code: "INVALID_NAME",
    });
    await expect(requestCatalogItem(officerA, { kind: "CROP", name: "Yam" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("officers forward, decline or match", () => {
  it("forwards once and only within the cooperative", async () => {
    const f1 = await farmer("u-f1", coopA);
    const request = await requestCatalogItem(f1, { kind: "CROP", name: "Tiger nut" });
    const queue = await listCooperativeCatalogRequests(officerA);
    expect(queue).toMatchObject([{ id: request.id, farmerName: "Farmer u-f1" }]);
    expect(JSON.stringify(queue)).not.toMatch(/@example\.com|\+234/);
    await expect(forwardCatalogRequest(officerB, request.id)).rejects.toMatchObject({
      constructor: NotFoundError,
      code: "REQUEST_NOT_FOUND",
    });
    await forwardCatalogRequest(officerA, request.id);
    await expect(forwardCatalogRequest(officerA, request.id)).rejects.toMatchObject({
      code: "REQUEST_NOT_OPEN",
    });
    expect(await listCooperativeCatalogRequests(officerA)).toEqual([]);
    expect((await listOwnCatalogRequests(f1))[0].status).toBe("FORWARDED");
  });

  it("declines with a reason the farmer sees", async () => {
    const f1 = await farmer("u-f1", coopA);
    const request = await requestCatalogItem(f1, { kind: "UNIT", name: "Mudu" });
    await expect(
      declineCatalogRequestAsOfficer(officerA, request.id, { reason: "x" }),
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await declineCatalogRequestAsOfficer(officerA, request.id, { reason: "We sell by the bag" });
    expect((await listOwnCatalogRequests(f1))[0]).toMatchObject({
      status: "DECLINED",
      declineReason: "We sell by the bag",
    });
  });

  it("matches a request to a crop already listed", async () => {
    const f1 = await farmer("u-f1", coopA);
    const sorghum = await createCrop(board, { name: "Sorghum" });
    const bag = await createUnit(board, { name: "Bag" });
    const request = await requestCatalogItem(f1, { kind: "CROP", name: "Guinea corn" });
    await expect(matchCatalogRequest(officerA, request.id, bag.id)).rejects.toMatchObject({
      code: "ITEM_NOT_FOUND",
    });
    await matchCatalogRequest(officerA, request.id, sorghum.id);
    expect((await listOwnCatalogRequests(f1))[0]).toMatchObject({
      status: "APPROVED",
      resolvedItemName: "Sorghum",
    });
  });

  it("refuses a board admin forwarding", async () => {
    const f1 = await farmer("u-f1", coopA);
    const request = await requestCatalogItem(f1, { kind: "CROP", name: "Tiger nut" });
    await expect(forwardCatalogRequest(board, request.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("board admins approve or decline", () => {
  it("approving one approves every open request for that name and adds the crop", async () => {
    const f1 = await farmer("u-f1", coopA);
    const f3 = await farmer("u-f3", coopB);
    const a = await requestCatalogItem(f1, { kind: "CROP", name: "Tiger nut" });
    const b = await requestCatalogItem(f3, { kind: "CROP", name: "tiger nut" });
    await forwardCatalogRequest(officerA, a.id);
    await forwardCatalogRequest(officerB, b.id);

    const groups = await listForwardedCatalogRequests(board);
    expect(groups).toHaveLength(1);
    expect(groups[0].cooperativeNames.sort()).toEqual(["Coop A", "Coop B"]);

    await approveCatalogRequest(board, a.id, { name: "Tiger Nut" });
    const crops = (await listActiveCatalog()).crops;
    expect(crops.map((c) => c.name)).toEqual(["Tiger Nut"]);
    expect((await listOwnCatalogRequests(f1))[0]).toMatchObject({
      status: "APPROVED",
      resolvedItemName: "Tiger Nut",
    });
    expect((await listOwnCatalogRequests(f3))[0].status).toBe("APPROVED");
    expect(await listForwardedCatalogRequests(board)).toEqual([]);

    const own = await updateOwnCrops(f1, [crops[0].id]);
    expect(own.crops.map((c) => c.name)).toEqual(["Tiger Nut"]);
  });

  it("reactivates a deactivated crop instead of creating a second", async () => {
    const f1 = await farmer("u-f1", coopA);
    const maize = await createCrop(board, { name: "Maize" });
    await setCropActive(board, maize.id, false);
    const request = await requestCatalogItem(f1, { kind: "CROP", name: "Maize" });
    await forwardCatalogRequest(officerA, request.id);
    await approveCatalogRequest(board, request.id, {});
    expect(await prisma.crop.count()).toBe(1);
    expect((await listActiveCatalog()).crops.map((c) => c.id)).toEqual([maize.id]);
  });

  it("declines one request with a reason", async () => {
    const f1 = await farmer("u-f1", coopA);
    const request = await requestCatalogItem(f1, { kind: "UNIT", name: "Mudu" });
    await forwardCatalogRequest(officerA, request.id);
    await declineCatalogRequest(board, request.id, { reason: "Use kg instead" });
    expect((await listOwnCatalogRequests(f1))[0]).toMatchObject({
      status: "DECLINED",
      declineReason: "Use kg instead",
    });
  });

  it("refuses an admin who is not a board admin", async () => {
    const f1 = await farmer("u-f1", coopA);
    const request = await requestCatalogItem(f1, { kind: "CROP", name: "Tiger nut" });
    await forwardCatalogRequest(officerA, request.id);
    await expect(approveCatalogRequest(admin, request.id, {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});
