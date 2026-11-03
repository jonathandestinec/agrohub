import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, lagosDateKey } from "@/lib/lagos-date";
import { fakeStorage } from "@/lib/storage";
import { recordPrice } from "@/modules/board/service";
import {
  getLotFormContext,
  getOwnLot,
  listOwnLots,
  setCropActive,
  submitLot,
} from "@/modules/catalog/service";
import { cleanDatabase } from "./helpers";
import { farmerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

let w: LotWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
});

afterAll(async () => {
  await cleanDatabase();
});

describe("submitLot", () => {
  it("creates a pending lot with the quoted terms, one contribution and its photo", async () => {
    const started = new Date();
    const lot = await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    expect(lot).toMatchObject({
      status: "PENDING_REVIEW",
      quantity: 30,
      askKobo: 6_500_000,
      floorKobo: 6_000_000,
      deviation: null,
      quoted: { cooperativeCutBps: 400, platformFeeBps: 300 },
      lockedTerms: null,
    });
    expect(lot.photoUrls).toHaveLength(1);
    const contributions = await prisma.lotContribution.findMany({ where: { lotId: lot.id } });
    expect(contributions.map((c) => [c.farmerUserId, c.quantity])).toEqual([["u-farmer", 30]]);
    expect(fakeStorage.objects.size).toBe(1);
    const audit = await prisma.auditLog.findMany({
      where: { action: "lot.submit", entityId: lot.id, createdAt: { gte: started } },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].meta)).not.toContain("6000000");
  });

  it("quotes the lower of the cooperative's cut and the maximum", async () => {
    await prisma.cooperative.update({ where: { id: w.cooperativeId }, data: { cutBps: 700 } });
    const lot = await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    expect(lot.quoted.cooperativeCutBps).toBe(500);
  });

  it("refuses a floor above the asking price", async () => {
    await expect(
      submitLot(w.farmer, w.input({ floorKobo: 6_500_001 }), [PHOTO], NOW),
    ).rejects.toMatchObject({ constructor: ValidationError, code: "FLOOR_ABOVE_ASK" });
  });

  it("refuses a cooperative that is not verified", async () => {
    await prisma.cooperative.update({ where: { id: w.cooperativeId }, data: { status: "PENDING" } });
    await expect(submitLot(w.farmer, w.input(), [PHOTO], NOW)).rejects.toMatchObject({
      code: "COOPERATIVE_NOT_VERIFIED",
    });
  });

  it("refuses a farmer without a payout account", async () => {
    const unbanked = await farmerMember("u-unbanked", w.cooperativeId, false);
    await expect(submitLot(unbanked, w.input(), [PHOTO], NOW)).rejects.toMatchObject({
      code: "BANK_ACCOUNT_REQUIRED",
    });
  });

  it("needs one to four photos whose contents match their type", async () => {
    await expect(submitLot(w.farmer, w.input(), [], NOW)).rejects.toMatchObject({ code: "PHOTO_COUNT" });
    await expect(submitLot(w.farmer, w.input(), Array(5).fill(PHOTO), NOW)).rejects.toMatchObject({
      code: "PHOTO_COUNT",
    });
    await expect(
      submitLot(w.farmer, w.input(), [{ body: Buffer.from("not an image"), contentType: "image/jpeg" }], NOW),
    ).rejects.toMatchObject({ code: "PHOTO_TYPE_MISMATCH" });
    expect(await prisma.lot.count()).toBe(0);
  });

  it("takes an available-until date from today to 90 days ahead in Lagos", async () => {
    const today = lagosDateKey(NOW);
    for (const bad of [addDays(today, -1), addDays(today, 91), "2026-13-01", "soon"]) {
      await expect(
        submitLot(w.farmer, w.input({ availableUntil: bad }), [PHOTO], NOW),
      ).rejects.toMatchObject({ code: "INVALID_AVAILABLE_UNTIL" });
    }
    await expect(submitLot(w.farmer, w.input({ availableUntil: today }), [PHOTO], NOW)).resolves.toBeTruthy();
    await expect(
      submitLot(w.farmer, w.input({ availableUntil: addDays(today, 90) }), [PHOTO], NOW),
    ).resolves.toBeTruthy();
  });

  it("refuses an inactive crop", async () => {
    await setCropActive(w.board, w.cropId, false);
    await expect(submitLot(w.farmer, w.input(), [PHOTO], NOW)).rejects.toMatchObject({
      code: "CROP_INACTIVE",
    });
  });

  it("needs a note when the asking price is far from the board", async () => {
    await recordPrice(
      w.board,
      { cropId: w.cropId, unitId: w.unitId, market: "Bodija", weekOf: lagosDateKey(NOW), priceKobo: 5_000_000 },
      NOW,
    );
    await expect(submitLot(w.farmer, w.input(), [PHOTO], NOW)).rejects.toMatchObject({
      code: "NOTE_REQUIRED",
    });
    await expect(
      submitLot(w.farmer, w.input({ note: "too short" }), [PHOTO], NOW),
    ).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
    const lot = await submitLot(w.farmer, w.input({ note: "Dried and cleaned, grade A" }), [PHOTO], NOW);
    expect(lot.deviation).toBe("HIGH");
  });

  it("refuses an officer", async () => {
    await expect(submitLot(w.officer, w.input(), [PHOTO], NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses quantities, prices, grades and states that are out of range", async () => {
    for (const bad of [
      { quantity: 0 },
      { quantity: 1.5 },
      { askKobo: 0 },
      { grade: "Z" },
      { pickupState: "Atlantis" },
    ]) {
      await expect(submitLot(w.farmer, w.input(bad), [PHOTO], NOW)).rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describe("a farmer's own lots", () => {
  it("lists only the caller's lots, newest first", async () => {
    const other = await farmerMember("u-other", w.cooperativeId);
    const first = await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    const second = await submitLot(w.farmer, w.input({ quantity: 5 }), [PHOTO], new Date(NOW.getTime() + 1000));
    await submitLot(other, w.input(), [PHOTO], NOW);
    expect((await listOwnLots(w.farmer)).map((l) => l.id)).toEqual([second.id, first.id]);
  });

  it("hides another farmer's lot as not found", async () => {
    const other = await farmerMember("u-other", w.cooperativeId);
    const lot = await submitLot(other, w.input(), [PHOTO], NOW);
    await expect(getOwnLot(w.farmer, lot.id)).rejects.toMatchObject({ code: "LOT_NOT_FOUND" });
    await expect(getOwnLot(w.farmer, "no-such-lot")).rejects.toMatchObject({ code: "LOT_NOT_FOUND" });
    expect((await getOwnLot(other, lot.id)).floorKobo).toBe(6_000_000);
  });
});

describe("getLotFormContext", () => {
  it("gives the quoted terms, the board prices and the farmer's place", async () => {
    await recordPrice(
      w.board,
      { cropId: w.cropId, unitId: w.unitId, market: "Bodija", weekOf: lagosDateKey(NOW), priceKobo: 5_000_000 },
      NOW,
    );
    const context = await getLotFormContext(w.farmer, NOW);
    expect(context).toMatchObject({
      blockedBy: null,
      quotedCutBps: 400,
      platformFeeBps: 300,
      priceDeviationBps: 2000,
      pickupState: "Kaduna",
      pickupLga: "Zaria",
      today: lagosDateKey(NOW),
    });
    expect(context.crops.map((c) => c.name)).toEqual(["Maize"]);
    expect(context.boardPrices[`${w.cropId}:${w.unitId}`]).toEqual([
      { market: "Bodija", weekOf: "2026-11-02", priceKobo: 5_000_000 },
    ]);
  });

  it("says why a farmer cannot list yet", async () => {
    const unbanked = await farmerMember("u-unbanked", w.cooperativeId, false);
    expect((await getLotFormContext(unbanked, NOW)).blockedBy).toBe("BANK_ACCOUNT_REQUIRED");
    await prisma.cooperative.update({ where: { id: w.cooperativeId }, data: { status: "SUSPENDED" } });
    expect((await getLotFormContext(w.farmer, NOW)).blockedBy).toBe("COOPERATIVE_NOT_VERIFIED");
  });
});
