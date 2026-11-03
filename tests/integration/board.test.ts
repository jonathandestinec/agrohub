import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { listPublicBoard, listWeek, recordPrice } from "@/modules/board/service";
import { createCrop, createUnit, setCropActive, setUnitActive } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { cleanDatabase, createTestUser } from "./helpers";

const NOW = new Date("2026-11-08T22:30:00Z"); // Sunday 23:30 in Lagos, week of 2026-11-02

let board: Actor;
let cropId: string;
let unitId: string;

function entry(overrides: Partial<Parameters<typeof recordPrice>[1]> = {}) {
  return { cropId, unitId, market: "Bodija Market", weekOf: "2026-11-04", priceKobo: 5_000_000, ...overrides };
}

beforeEach(async () => {
  await cleanDatabase();
  const user = await createTestUser({ id: "u-board" });
  board = { userId: user.id, role: "BOARD_ADMIN", cooperativeId: null, twoFactorEnabled: true };
  cropId = (await createCrop(board, { name: "Maize" })).id;
  unitId = (await createUnit(board, { name: "Bag" })).id;
});

afterAll(async () => {
  await cleanDatabase();
});

describe("recordPrice", () => {
  it("stores the Monday of the week and audits the new price", async () => {
    const saved = await recordPrice(board, entry(), NOW);
    expect(saved).toMatchObject({ crop: "Maize", unit: "Bag", market: "Bodija Market", weekOf: "2026-11-02", priceKobo: 5_000_000 });
    const audit = await prisma.auditLog.findMany({ where: { action: "price.record", entityId: saved.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0].meta).toMatchObject({ cropId, unitId, weekOf: "2026-11-02", priceKobo: 5_000_000 });
  });

  it("duplicate_entry_updates_one_row", async () => {
    await recordPrice(board, entry({ priceKobo: 50000 }), NOW);
    await recordPrice(board, entry({ priceKobo: 52000 }), NOW);
    await recordPrice(board, entry({ priceKobo: 52000 }), NOW);
    const rows = await prisma.pricePoint.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].priceKobo).toBe(52000);
    const updates = await prisma.auditLog.findMany({ where: { action: "price.update", entityId: rows[0].id } });
    expect(updates).toHaveLength(1);
    expect(updates[0].meta).toMatchObject({ fromKobo: 50000, toKobo: 52000 });
  });

  it("market_names_are_normalized", async () => {
    await recordPrice(board, entry({ market: "Bodija Market" }), NOW);
    await recordPrice(board, entry({ market: " bodija  market" }), NOW);
    const rows = await prisma.pricePoint.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].market).toBe("bodija market");
  });

  it("week_of_uses_lagos_time and future_week_is_refused", async () => {
    await expect(recordPrice(board, entry({ weekOf: "2026-11-09" }), NOW)).rejects.toMatchObject({
      constructor: ValidationError,
      code: "FUTURE_WEEK",
    });
    await expect(recordPrice(board, entry({ weekOf: "2026-11-02" }), NOW)).resolves.toMatchObject({
      weekOf: "2026-11-02",
    });
    await expect(recordPrice(board, entry({ weekOf: "2026-10-20" }), NOW)).resolves.toMatchObject({
      weekOf: "2026-10-19",
    });
  });

  it("inactive_crop_or_unit_is_refused", async () => {
    await setCropActive(board, cropId, false);
    await expect(recordPrice(board, entry(), NOW)).rejects.toMatchObject({ code: "CROP_INACTIVE" });
    await setCropActive(board, cropId, true);
    await setUnitActive(board, unitId, false);
    await expect(recordPrice(board, entry(), NOW)).rejects.toMatchObject({ code: "UNIT_INACTIVE" });
  });

  it("admin_cannot_record_price", async () => {
    const admin: Actor = { ...board, role: "ADMIN" };
    await expect(recordPrice(admin, entry(), NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listWeek(admin, "2026-11-02")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a zero, fractional or malformed price or week", async () => {
    for (const bad of [entry({ priceKobo: 0 }), entry({ priceKobo: 1.5 }), entry({ weekOf: "4/11/2026" }), entry({ market: "  " })]) {
      await expect(recordPrice(board, bad, NOW)).rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describe("listWeek", () => {
  it("lists the week's entries sorted by crop, unit and market", async () => {
    const rice = await createCrop(board, { name: "Rice" });
    await recordPrice(board, entry({ cropId: rice.id, market: "Mile 12" }), NOW);
    await recordPrice(board, entry({ market: "Kano Dawanau" }), NOW);
    await recordPrice(board, entry({ market: "Bodija Market" }), NOW);
    await recordPrice(board, entry({ weekOf: "2026-10-26" }), NOW);
    const week = await listWeek(board, "2026-11-04");
    expect(week.map((e) => `${e.crop}/${e.market}`)).toEqual([
      "Maize/Bodija Market",
      "Maize/Kano Dawanau",
      "Rice/Mile 12",
    ]);
  });
});

describe("listPublicBoard", () => {
  it("public_board_shows_latest_and_previous", async () => {
    await recordPrice(board, entry({ weekOf: "2026-10-19", priceKobo: 48000 }), NOW);
    await recordPrice(board, entry({ weekOf: "2026-10-26", priceKobo: 50000 }), NOW);
    expect(await listPublicBoard()).toEqual([
      { crop: "Maize", unit: "Bag", market: "Bodija Market", weekOf: "2026-10-26", priceKobo: 50000, previousKobo: 48000 },
    ]);
  });

  it("gives a first price no previous price", async () => {
    await recordPrice(board, entry({ priceKobo: 50000 }), NOW);
    const [row] = await listPublicBoard();
    expect(row.previousKobo).toBeNull();
  });

  it("public_board_hides_inactive_crops", async () => {
    await recordPrice(board, entry(), NOW);
    await setCropActive(board, cropId, false);
    expect(await listPublicBoard()).toEqual([]);
    await setCropActive(board, cropId, true);
    await setUnitActive(board, unitId, false);
    expect(await listPublicBoard()).toEqual([]);
  });

  it("filters by crop and sorts by crop, unit and market", async () => {
    const rice = await createCrop(board, { name: "Rice" });
    await recordPrice(board, entry({ cropId: rice.id, market: "Mile 12" }), NOW);
    await recordPrice(board, entry({ market: "Kano Dawanau" }), NOW);
    await recordPrice(board, entry({ market: "Bodija Market" }), NOW);
    expect((await listPublicBoard()).map((r) => `${r.crop}/${r.market}`)).toEqual([
      "Maize/Bodija Market",
      "Maize/Kano Dawanau",
      "Rice/Mile 12",
    ]);
    expect((await listPublicBoard({ cropId: rice.id })).map((r) => r.crop)).toEqual(["Rice"]);
  });

  it("never carries the recording user", async () => {
    await recordPrice(board, entry(), NOW);
    expect(JSON.stringify(await listPublicBoard())).not.toContain(board.userId);
  });
});
