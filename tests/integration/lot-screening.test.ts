import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { fakeStorage } from "@/lib/storage";
import {
  approveLot,
  counterLot,
  getLotForScreening,
  getOwnLot,
  listScreeningQueue,
  rejectLot,
  respondToCounter,
  submitLot,
} from "@/modules/catalog/service";
import { setCooperativeCut } from "@/modules/cooperatives/service";
import type { Actor } from "@/modules/identity/policies";
import { DEFAULT_SETTINGS, updatePlatformSettings } from "@/modules/settings/service";
import { cleanDatabase, createTestCooperative } from "./helpers";
import { farmerMember, lotWorld, NOW, officerMember, PHOTO, type LotWorld } from "./lot-fixtures";

let w: LotWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
});

afterAll(async () => {
  await cleanDatabase();
});

const submit = (farmer: Actor = w.farmer, overrides = {}) => submitLot(farmer, w.input(overrides), [PHOTO], NOW);

// The farmer also holds an OFFICER membership in the same cooperative.
async function farmerAsOfficer(): Promise<Actor> {
  return officerMember(w.farmer.userId, w.cooperativeId);
}

async function onlyOfficerIsTheFarmer(): Promise<Actor> {
  await prisma.membership.updateMany({
    where: { userId: w.officer.userId, role: "OFFICER" },
    data: { status: "REMOVED" },
  });
  return farmerAsOfficer();
}

describe("self-approval rule", () => {
  it("officer_cannot_approve_own_lot", async () => {
    const lot = await submit();
    const self = await farmerAsOfficer();
    for (const attempt of [
      approveLot(self, lot.id, { minOrderQty: 1 }, NOW),
      rejectLot(self, lot.id, { reason: "Not today" }),
      counterLot(self, lot.id, { counterAskKobo: 6_200_000 }),
    ]) {
      await expect(attempt).rejects.toMatchObject({
        constructor: ForbiddenError,
        code: "CANNOT_APPROVE_OWN_LOT",
      });
    }
    const approved = await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
    expect(approved.status).toBe("LIVE");
  });

  it("shows the officer their own lot in the queue but marks it", async () => {
    const lot = await submit();
    const self = await farmerAsOfficer();
    const queue = await listScreeningQueue(self);
    expect(queue.map((l) => [l.id, l.canApprove])).toEqual([[lot.id, false]]);
    expect((await getLotForScreening(self, lot.id)).canApprove).toBe(false);
  });

  it("admin_approves_when_no_other_officer", async () => {
    const lot = await submit();
    const self = await onlyOfficerIsTheFarmer();
    await expect(approveLot(self, lot.id, { minOrderQty: 1 }, NOW)).rejects.toMatchObject({
      code: "CANNOT_APPROVE_OWN_LOT",
    });
    expect((await listScreeningQueue(w.admin)).map((l) => l.id)).toEqual([lot.id]);
    const approved = await approveLot(w.admin, lot.id, { minOrderQty: 1 }, NOW);
    expect(approved.status).toBe("LIVE");
    expect(await listScreeningQueue(w.admin)).toEqual([]);
  });

  it("admin_cannot_approve_when_other_officer_exists", async () => {
    const lot = await submit();
    await expect(approveLot(w.admin, lot.id, { minOrderQty: 1 }, NOW)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await listScreeningQueue(w.admin)).toEqual([]);
  });

  it("refuses an officer of another cooperative", async () => {
    const lot = await submit();
    const other = (await createTestCooperative({ status: "VERIFIED" })).id;
    const stranger = await officerMember("u-stranger", other);
    await expect(approveLot(stranger, lot.id, { minOrderQty: 1 }, NOW)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(getLotForScreening(stranger, lot.id)).rejects.toMatchObject({ code: "LOT_NOT_FOUND" });
    expect(await listScreeningQueue(stranger)).toEqual([]);
  });

  it("refuses a farmer screening", async () => {
    await expect(listScreeningQueue(w.farmer)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("approval locks the fee terms", () => {
  it("terms_locked_at_quote_survive_setting_change", async () => {
    const lot = await submit();
    await updatePlatformSettings(w.admin, { ...DEFAULT_SETTINGS, platformFeeBps: 250 });
    await setCooperativeCut(w.officer, w.cooperativeId, 200);

    const approved = await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
    expect(approved).toMatchObject({
      status: "LIVE",
      minOrderQty: 5,
      lockedTerms: { cooperativeCutBps: 400, platformFeeBps: 300 },
    });
    const terms = await prisma.lotFeeTerms.findUniqueOrThrow({ where: { lotId: lot.id } });
    expect(terms.lockedAt).toEqual(NOW);

    const later = await submit();
    expect(later.quoted).toEqual({ cooperativeCutBps: 200, platformFeeBps: 250 });
  });

  it("takes a minimum order from 1 to the quantity", async () => {
    const lot = await submit();
    for (const bad of [0, 31, 1.5]) {
      await expect(approveLot(w.officer, lot.id, { minOrderQty: bad }, NOW)).rejects.toMatchObject({
        code: "INVALID_MIN_ORDER",
      });
    }
  });
});

describe("screening decisions", () => {
  it("concurrent_screening_has_one_winner", async () => {
    const lot = await submit();
    const second = await officerMember("u-officer-2", w.cooperativeId);
    const started = new Date();
    const results = await Promise.allSettled([
      approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW),
      rejectLot(second, lot.id, { reason: "Photos are unclear" }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      constructor: ConflictError,
      code: "LOT_NOT_PENDING",
    });
    const audit = await prisma.auditLog.count({
      where: { entityId: lot.id, action: { in: ["lot.approve", "lot.reject"] }, createdAt: { gte: started } },
    });
    expect(audit).toBe(1);
    expect(await prisma.lotFeeTerms.count({ where: { lotId: lot.id } })).toBeLessThanOrEqual(1);
  });

  it("rejects with a reason the farmer sees", async () => {
    const lot = await submit();
    await expect(rejectLot(w.officer, lot.id, { reason: "no" })).rejects.toMatchObject({
      code: "REASON_REQUIRED",
    });
    await rejectLot(w.officer, lot.id, { reason: "Photos are unclear" });
    expect(await getOwnLot(w.farmer, lot.id)).toMatchObject({
      status: "REJECTED",
      rejectionReason: "Photos are unclear",
    });
  });

  it("counters at or above the floor, and the farmer accepts", async () => {
    const lot = await submit();
    await expect(counterLot(w.officer, lot.id, { counterAskKobo: 5_000_000 })).rejects.toMatchObject({
      code: "COUNTER_BELOW_FLOOR",
    });
    await expect(counterLot(w.officer, lot.id, { counterAskKobo: 6_500_000 })).rejects.toMatchObject({
      code: "COUNTER_SAME_AS_ASK",
    });
    await counterLot(w.officer, lot.id, { counterAskKobo: 6_200_000, message: "Market is soft this week" });
    expect(await getOwnLot(w.farmer, lot.id)).toMatchObject({
      status: "COUNTERED",
      counterAskKobo: 6_200_000,
      counterMessage: "Market is soft this week",
    });
    await expect(approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW)).rejects.toMatchObject({
      code: "LOT_NOT_PENDING",
    });

    const accepted = await respondToCounter(w.farmer, lot.id, true, NOW);
    expect(accepted).toMatchObject({
      status: "LIVE",
      askKobo: 6_200_000,
      counterAskKobo: null,
      lockedTerms: { cooperativeCutBps: 400, platformFeeBps: 300 },
    });
    await expect(respondToCounter(w.farmer, lot.id, true, NOW)).rejects.toMatchObject({
      code: "LOT_NOT_COUNTERED",
    });
  });

  it("withdraws the lot when the farmer declines a counter", async () => {
    const lot = await submit();
    await counterLot(w.officer, lot.id, { counterAskKobo: 6_200_000 });
    const other = await farmerMember("u-other", w.cooperativeId);
    await expect(respondToCounter(other, lot.id, false, NOW)).rejects.toMatchObject({
      code: "LOT_NOT_FOUND",
    });
    const declined = await respondToCounter(w.farmer, lot.id, false, NOW);
    expect(declined).toMatchObject({ status: "WITHDRAWN", askKobo: 6_500_000, counterAskKobo: null });
    expect(await prisma.lotFeeTerms.count()).toBe(0);
  });

  it("audit_meta_never_contains_floor", async () => {
    const started = new Date();
    const first = await submit();
    await counterLot(w.officer, first.id, { counterAskKobo: 6_200_000 });
    await respondToCounter(w.farmer, first.id, true, NOW);
    const second = await submit();
    await approveLot(w.officer, second.id, { minOrderQty: 2 }, NOW);
    const third = await submit();
    await rejectLot(w.officer, third.id, { reason: "Below 6000000 is too low" });

    const rows = await prisma.auditLog.findMany({
      where: { entity: "lot", createdAt: { gte: started } },
    });
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) expect(JSON.stringify(row.meta)).not.toContain("6000000");
  });
});
