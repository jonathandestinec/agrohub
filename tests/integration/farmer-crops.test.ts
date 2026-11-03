import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { createCrop, setCropActive } from "@/modules/catalog/service";
import { getOwnFarmerOverview, joinViaLink, updateOwnCrops } from "@/modules/farmers/service";
import type { Actor } from "@/modules/identity/policies";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

const T = new Date("2031-06-10T12:00:00Z");
const PROFILE = { farmSizeHectares: "2.5", state: "Ogun", lga: "Abeokuta North" };

let token: string;
let cooperativeId: string;
let board: Actor;
let maize: string;
let cassava: string;
let yam: string;

beforeEach(async () => {
  await cleanDatabase();
  cooperativeId = (await createTestCooperative({ status: "VERIFIED" })).id;
  token = `tok-${cooperativeId}`;
  await prisma.inviteLink.create({ data: { cooperativeId, token, createdBy: "u-officer" } });
  const boardUser = await createTestUser({ id: "u-board" });
  board = { userId: boardUser.id, role: "BOARD_ADMIN", cooperativeId: null, twoFactorEnabled: true };
  maize = (await createCrop(board, { name: "Maize" })).id;
  cassava = (await createCrop(board, { name: "Cassava" })).id;
  yam = (await createCrop(board, { name: "Yam" })).id;
});

afterAll(async () => {
  await cleanDatabase();
});

async function joined(userId: string, cropIds: string[]): Promise<Actor> {
  await createTestUser({ id: userId });
  await joinViaLink({ userId }, token, { ...PROFILE, cropIds }, T);
  await prisma.membership.updateMany({ where: { userId }, data: { status: "ACTIVE" } });
  return { userId, role: "FARMER", cooperativeId, twoFactorEnabled: false };
}

describe("farmer crops from the board's crop list", () => {
  it("links the chosen crops and shows their names", async () => {
    await joined("u-f1", [maize, cassava]);
    const { profile } = await getOwnFarmerOverview({ userId: "u-f1" });
    expect(profile?.crops).toEqual([
      { id: cassava, name: "Cassava" },
      { id: maize, name: "Maize" },
    ]);
  });

  it("lets a farmer join without choosing crops", async () => {
    await joined("u-f1", []);
    const { profile } = await getOwnFarmerOverview({ userId: "u-f1" });
    expect(profile?.crops).toEqual([]);
  });

  it("refuses a deactivated or unknown crop", async () => {
    await setCropActive(board, yam, false);
    await createTestUser({ id: "u-f1" });
    for (const cropIds of [[yam], ["no-such-crop"]]) {
      await expect(
        joinViaLink({ userId: "u-f1" }, token, { ...PROFILE, cropIds }, T),
      ).rejects.toMatchObject({ constructor: ValidationError, code: "CROP_INACTIVE" });
    }
    expect(await prisma.membership.count()).toBe(0);
  });

  it("lets a farmer replace their crops", async () => {
    const farmer = await joined("u-f1", [maize]);
    const updated = await updateOwnCrops(farmer, [yam, cassava]);
    expect(updated.crops.map((c) => c.name)).toEqual(["Cassava", "Yam"]);
    await expect(updateOwnCrops(farmer, [yam, yam])).resolves.toMatchObject({
      crops: [{ id: yam, name: "Yam" }],
    });
  });

  it("refuses an officer", async () => {
    const officer: Actor = { userId: "u-f1", role: "OFFICER", cooperativeId, twoFactorEnabled: false };
    await expect(updateOwnCrops(officer, [maize])).rejects.toBeInstanceOf(ForbiddenError);
  });
});
