import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, lagosDateKey } from "@/lib/lagos-date";
import { fakeStorage } from "@/lib/storage";
import {
  approveLot,
  counterLot,
  listLiveLots,
  rejectLot,
  submitLot,
  withdrawLot,
} from "@/modules/catalog/service";
import { reinstateCooperative, suspendCooperative } from "@/modules/cooperatives/service";
import { cleanDatabase } from "./helpers";
import { lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

const FLOOR = 4_321_987;
let w: LotWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
});

afterAll(async () => {
  await cleanDatabase();
});

async function live(overrides = {}) {
  const lot = await submitLot(w.farmer, w.input({ floorKobo: FLOOR, ...overrides }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 2 }, NOW);
  return lot;
}

describe("listLiveLots", () => {
  it("public_lots_never_contain_floor", async () => {
    const lot = await live();
    const lots = await listLiveLots(NOW);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      id: lot.id,
      cooperativeName: "Zaria Growers",
      crop: "Maize",
      unit: "Bag",
      askKobo: 6_500_000,
      minOrderQty: 2,
    });
    expect(lots[0].photoUrls).toHaveLength(1);
    const json = JSON.stringify(lots);
    expect(json).not.toContain(String(FLOOR));
    expect(json).not.toMatch(/floor/i);
    expect(json).not.toContain(w.farmer.userId);
    expect(json).not.toContain("Farmer u-farmer");
  });

  it("shows only live lots", async () => {
    const shown = await live();
    await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    const countered = await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    await counterLot(w.officer, countered.id, { counterAskKobo: 6_200_000 });
    const rejected = await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    await rejectLot(w.officer, rejected.id, { reason: "Photos are unclear" });
    const withdrawn = await live();
    await withdrawLot(w.farmer, withdrawn.id);
    expect((await listLiveLots(NOW)).map((l) => l.id)).toEqual([shown.id]);
  });

  it("suspended_cooperative_lots_are_hidden", async () => {
    const lot = await live();
    await suspendCooperative(w.admin, w.cooperativeId, "Documents under review");
    expect(await listLiveLots(NOW)).toEqual([]);
    await reinstateCooperative(w.admin, w.cooperativeId, NOW);
    expect((await listLiveLots(NOW)).map((l) => l.id)).toEqual([lot.id]);
  });

  it("lot_past_available_until_is_hidden_before_job_runs", async () => {
    const until = addDays(lagosDateKey(NOW), 3);
    await live({ availableUntil: until });
    const lastDay = new Date(`${until}T22:00:00Z`); // 23:00 in Lagos, still that day
    const nextDay = new Date(`${until}T23:30:00Z`); // 00:30 in Lagos, the day after
    expect(await listLiveLots(lastDay)).toHaveLength(1);
    expect(await listLiveLots(nextDay)).toEqual([]);
    expect(await prisma.lot.count({ where: { status: "LIVE" } })).toBe(1);
  });
});
