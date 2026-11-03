import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { getOwnCooperative, setCooperativeCut } from "@/modules/cooperatives/service";
import type { Actor } from "@/modules/identity/policies";
import { DEFAULT_SETTINGS, updatePlatformSettings } from "@/modules/settings/service";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

let officer: Actor;
let otherOfficer: Actor;
let admin: Actor;
let cooperativeId: string;

beforeEach(async () => {
  await cleanDatabase();
  const coop = await createTestCooperative({ status: "VERIFIED" });
  const other = await createTestCooperative();
  cooperativeId = coop.id;
  const user = await createTestUser();
  officer = { userId: user.id, role: "OFFICER", cooperativeId: coop.id, twoFactorEnabled: false };
  otherOfficer = { userId: user.id, role: "OFFICER", cooperativeId: other.id, twoFactorEnabled: false };
  admin = { userId: user.id, role: "ADMIN", cooperativeId: null, twoFactorEnabled: true };
});

afterAll(async () => {
  await cleanDatabase();
});

describe("cooperative cut", () => {
  it("starts at 0 and is set by an officer, with an audit row", async () => {
    expect((await getOwnCooperative(officer)).cooperative.cutBps).toBe(0);
    const started = new Date();
    expect(await setCooperativeCut(officer, cooperativeId, 400)).toEqual({ cutBps: 400 });
    const row = await prisma.cooperative.findUniqueOrThrow({ where: { id: cooperativeId } });
    expect(row.cutBps).toBe(400);
    const audit = await prisma.auditLog.findMany({
      where: { action: "cooperative.cut", entityId: cooperativeId, createdAt: { gte: started } },
    });
    expect(audit.map((a) => a.meta)).toEqual([{ cooperativeId, fromBps: 0, toBps: 400 }]);
  });

  it("refuses a cut above the admin maximum", async () => {
    await expect(setCooperativeCut(officer, cooperativeId, 501)).rejects.toMatchObject({
      constructor: ValidationError,
      code: "CUT_ABOVE_MAXIMUM",
    });
    await updatePlatformSettings(admin, { ...DEFAULT_SETTINGS, maxCooperativeCutBps: 300 });
    await expect(setCooperativeCut(officer, cooperativeId, 400)).rejects.toMatchObject({
      code: "CUT_ABOVE_MAXIMUM",
    });
  });

  it("refuses a cut that is not whole basis points", async () => {
    for (const bad of [1.5, -1, Number.NaN]) {
      await expect(setCooperativeCut(officer, cooperativeId, bad)).rejects.toMatchObject({
        code: "INVALID_CUT",
      });
    }
  });

  it("refuses an officer of another cooperative", async () => {
    await expect(setCooperativeCut(otherOfficer, cooperativeId, 100)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
