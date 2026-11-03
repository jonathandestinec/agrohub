import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fakeStorage } from "@/lib/storage";
import { approveLot, createCrop, searchLiveLots, submitLot } from "@/modules/catalog/service";
import { parseLotFilters } from "@/modules/catalog/search-schema";
import { suspendCooperative } from "@/modules/cooperatives/service";
import { cleanDatabase } from "./helpers";
import { lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

const FLOOR = 4_321_987;
let w: LotWorld;
let yamId: string;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
  yamId = (await createCrop(w.board, { name: "Yam" })).id;
});

afterAll(cleanDatabase);

async function live(overrides: Record<string, unknown>) {
  const lot = await submitLot(w.farmer, w.input({ floorKobo: 1, ...overrides }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
  return lot;
}

const filters = (params: Record<string, string>) => parseLotFilters(params);

async function four() {
  await live({ cropId: w.cropId, grade: "A", pickupState: "Oyo", askKobo: 50_000, quantity: 20 });
  await live({ cropId: w.cropId, grade: "B", pickupState: "Kano", askKobo: 70_000, quantity: 20 });
  await live({ cropId: yamId, grade: "A", pickupState: "Oyo", askKobo: 90_000, quantity: 5 });
  await live({ cropId: yamId, grade: "C", pickupState: "Kano", askKobo: 30_000, quantity: 50 });
}

describe("searchLiveLots", () => {
  it("filters by crop, state, grade, price and quantity", async () => {
    await four();
    const count = async (p: Record<string, string>) => (await searchLiveLots(filters(p), NOW)).lots.length;
    expect(await count({ cropId: w.cropId })).toBe(2);
    expect(await count({ state: "Oyo" })).toBe(2);
    expect(await count({ grade: "A" })).toBe(2);
    expect(await count({ minPrice: "400", maxPrice: "800" })).toBe(2);
    expect(await count({ minQuantity: "10" })).toBe(3);
    expect(await count({ cropId: w.cropId, state: "Oyo" })).toBe(1);
    expect(await count({})).toBe(4);
  });

  it("sorts by price in either direction", async () => {
    await four();
    const asc = await searchLiveLots(filters({ sort: "price_asc" }), NOW);
    expect(asc.lots.map((l) => l.askKobo)).toEqual([30_000, 50_000, 70_000, 90_000]);
    const desc = await searchLiveLots(filters({ sort: "price_desc" }), NOW);
    expect(desc.lots.map((l) => l.askKobo)).toEqual([90_000, 70_000, 50_000, 30_000]);
  });

  it("pages 24 lots at a time", async () => {
    for (let i = 0; i < 30; i += 1) await live({ askKobo: 10_000 + i });
    const first = await searchLiveLots(filters({}), NOW);
    expect(first).toMatchObject({ page: 1, hasMore: true });
    expect(first.lots).toHaveLength(24);
    const second = await searchLiveLots(filters({ page: "2" }), NOW);
    expect(second).toMatchObject({ page: 2, hasMore: false });
    expect(second.lots).toHaveLength(6);
    const ids = new Set([...first.lots, ...second.lots].map((l) => l.id));
    expect(ids.size).toBe(30);
  });

  it("finds a cooperative's lots and never a suspended cooperative's", async () => {
    await four();
    expect((await searchLiveLots(filters({ cooperativeId: w.cooperativeId }), NOW)).lots).toHaveLength(4);
    await suspendCooperative(w.admin, w.cooperativeId, "Certificate under review");
    expect((await searchLiveLots(filters({}), NOW)).lots).toHaveLength(0);
  });

  it("never carries the floor", async () => {
    await live({ floorKobo: FLOOR, askKobo: 6_500_000 });
    const json = JSON.stringify(await searchLiveLots(filters({}), NOW));
    expect(json).not.toContain(String(FLOOR));
    expect(json).not.toMatch(/floor/i);
  });

  it("links each lot to its cooperative", async () => {
    await live({});
    const [lot] = (await searchLiveLots(filters({}), NOW)).lots;
    expect(lot.cooperativeId).toBe(w.cooperativeId);
  });
});
