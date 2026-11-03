import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/modules/identity/policies";
import {
  DEFAULT_SETTINGS,
  getPlatformSettings,
  updatePlatformSettings,
} from "@/modules/settings/service";
import { cleanDatabase, createTestUser } from "./helpers";

let admin: Actor;
let board: Actor;

beforeEach(async () => {
  await cleanDatabase();
  const user = await createTestUser({ id: "u-admin" });
  admin = { userId: user.id, role: "ADMIN", cooperativeId: null, twoFactorEnabled: true };
  board = { userId: user.id, role: "BOARD_ADMIN", cooperativeId: null, twoFactorEnabled: true };
});

afterAll(async () => {
  await cleanDatabase();
});

describe("platform settings", () => {
  it("falls back to the defaults when nothing is stored", async () => {
    expect(DEFAULT_SETTINGS).toEqual({
      platformFeeBps: 300,
      maxCooperativeCutBps: 500,
      priceDeviationBps: 2000,
    });
    expect(await getPlatformSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("lets an admin change a value and audits only the changed key", async () => {
    const started = new Date();
    const saved = await updatePlatformSettings(admin, { ...DEFAULT_SETTINGS, platformFeeBps: 250 });
    expect(saved.platformFeeBps).toBe(250);
    expect((await getPlatformSettings()).platformFeeBps).toBe(250);
    const row = await prisma.setting.findUnique({ where: { key: "platform_fee_bps" } });
    expect(row?.value).toBe("250");

    const audit = await prisma.auditLog.findMany({
      where: { action: "setting.update", createdAt: { gte: started } },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].meta).toEqual({ key: "platform_fee_bps", fromBps: 300, toBps: 250 });
  });

  it("writes nothing when nothing changes", async () => {
    const before = await prisma.auditLog.count({ where: { action: "setting.update" } });
    await updatePlatformSettings(admin, DEFAULT_SETTINGS);
    expect(await prisma.setting.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "setting.update" } })).toBe(before);
  });

  it("refuses a board admin", async () => {
    await expect(updatePlatformSettings(board, DEFAULT_SETTINGS)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("refuses values outside the bounds", async () => {
    for (const bad of [
      { ...DEFAULT_SETTINGS, platformFeeBps: 5001 },
      { ...DEFAULT_SETTINGS, maxCooperativeCutBps: -1 },
      { ...DEFAULT_SETTINGS, priceDeviationBps: 99 },
      { ...DEFAULT_SETTINGS, platformFeeBps: 2.5 },
    ]) {
      await expect(updatePlatformSettings(admin, bad)).rejects.toMatchObject({
        constructor: ValidationError,
        code: "INVALID_SETTING",
      });
    }
  });

  it("fails loudly on a corrupt stored value", async () => {
    await prisma.setting.create({ data: { key: "platform_fee_bps", value: "3%" } });
    await expect(getPlatformSettings()).rejects.toThrow(RangeError);
  });
});
