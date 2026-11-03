import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, lagosDateKey } from "@/lib/lagos-date";
import { fakeStorage } from "@/lib/storage";
import { approveLot, getPublicLot, submitLot, withdrawLot } from "@/modules/catalog/service";
import { getPublicCooperative, suspendCooperative } from "@/modules/cooperatives/service";
import { cleanDatabase, createTestCooperative } from "./helpers";
import { lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

const FLOOR = 4_321_987;
let w: LotWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
});

afterAll(cleanDatabase);

async function live() {
  const lot = await submitLot(w.farmer, w.input({ floorKobo: FLOOR }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 2 }, NOW);
  return lot;
}

describe("getPublicLot", () => {
  it("returns a live lot without the floor or the farmer", async () => {
    const lot = await live();
    const shown = await getPublicLot(lot.id, NOW);
    expect(shown).toMatchObject({ id: lot.id, cooperativeId: w.cooperativeId, askKobo: 6_500_000 });
    const json = JSON.stringify(shown);
    expect(json).not.toContain(String(FLOOR));
    expect(json).not.toMatch(/floor/i);
    expect(json).not.toContain(w.farmer.userId);
    expect(json).not.toContain("Farmer u-farmer");
  });

  it("treats a pending, withdrawn or past-date lot as missing", async () => {
    const pending = await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    await expect(getPublicLot(pending.id, NOW)).rejects.toMatchObject({ code: "LOT_NOT_FOUND" });
    const withdrawn = await live();
    await withdrawLot(w.farmer, withdrawn.id);
    await expect(getPublicLot(withdrawn.id, NOW)).rejects.toMatchObject({ code: "LOT_NOT_FOUND" });
    const lot = await live();
    const after = new Date(`${addDays(lagosDateKey(NOW), 15)}T12:00:00Z`);
    await expect(getPublicLot(lot.id, after)).rejects.toMatchObject({ code: "LOT_NOT_FOUND" });
    await expect(getPublicLot("no-such-lot", NOW)).rejects.toMatchObject({ code: "LOT_NOT_FOUND" });
  });

  it("hides a suspended cooperative's lot", async () => {
    const lot = await live();
    await suspendCooperative(w.admin, w.cooperativeId, "Certificate under review");
    await expect(getPublicLot(lot.id, NOW)).rejects.toMatchObject({ code: "LOT_NOT_FOUND" });
  });
});

describe("getPublicCooperative", () => {
  it("shows a verified cooperative's public fields and nothing else", async () => {
    await prisma.cooperative.update({
      where: { id: w.cooperativeId },
      data: { verifiedAt: new Date("2026-10-15T09:00:00Z"), recipientCode: "RCP_secret", accountName: "ZARIA GROWERS" },
    });
    const shown = await getPublicCooperative(w.cooperativeId);
    expect(Object.keys(shown).sort()).toEqual(["id", "lga", "name", "state", "verifiedSince"]);
    expect(shown).toMatchObject({ name: "Zaria Growers", state: "Kaduna", lga: "Zaria", verifiedSince: "2026-10" });
    expect(JSON.stringify(shown)).not.toContain("RCP_secret");
  });

  it("treats a pending or suspended cooperative as missing", async () => {
    const pending = await createTestCooperative({ status: "PENDING" });
    await expect(getPublicCooperative(pending.id)).rejects.toMatchObject({ code: "COOPERATIVE_NOT_FOUND" });
    await suspendCooperative(w.admin, w.cooperativeId, "Certificate under review");
    await expect(getPublicCooperative(w.cooperativeId)).rejects.toMatchObject({ code: "COOPERATIVE_NOT_FOUND" });
  });
});
