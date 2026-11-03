import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { fakeStorage } from "@/lib/storage";
import {
  approveLot,
  decideRevision,
  getOwnLot,
  listScreeningQueue,
  rejectLot,
  requestRevision,
  submitLot,
  withdrawLot,
} from "@/modules/catalog/service";
import { cleanDatabase } from "./helpers";
import { lotWorld, NOW, officerMember, PHOTO, type LotWorld } from "./lot-fixtures";

const guard = vi.hoisted(() => ({ open: false }));
vi.mock("@/modules/catalog/orders-guard", () => ({ hasOpenOrders: async () => guard.open }));

let w: LotWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  guard.open = false;
  w = await lotWorld();
});

afterAll(async () => {
  await cleanDatabase();
});

async function liveLot() {
  const lot = await submitLot(w.farmer, w.input({ askKobo: 5_000_000, floorKobo: 4_500_000 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
  return lot;
}

const change = { askKobo: 5_500_000, quantity: 40, floorKobo: 5_000_000 };

describe("revisions to a live lot", () => {
  it("keeps the live version until an officer approves the change, and keeps the locked terms", async () => {
    const lot = await liveLot();
    const pending = await requestRevision(w.farmer, lot.id, change, NOW);
    expect(pending.pendingRevision).toMatchObject({ askKobo: 5_500_000, quantity: 40 });
    expect(pending).toMatchObject({ status: "LIVE", askKobo: 5_000_000, quantity: 30 });
    const queue = await listScreeningQueue(w.officer);
    expect(queue.map((l) => l.id)).toEqual([lot.id]);

    await decideRevision(w.officer, pending.pendingRevision!.id, { approve: true }, NOW);
    expect(await getOwnLot(w.farmer, lot.id)).toMatchObject({
      status: "LIVE",
      askKobo: 5_500_000,
      quantity: 40,
      floorKobo: 5_000_000,
      pendingRevision: null,
      lockedTerms: { cooperativeCutBps: 400, platformFeeBps: 300 },
    });
    const contribution = await prisma.lotContribution.findFirstOrThrow({ where: { lotId: lot.id } });
    expect(contribution.quantity).toBe(40);
  });

  it("supersedes an earlier pending change with a newer one", async () => {
    const lot = await liveLot();
    const first = (await requestRevision(w.farmer, lot.id, change, NOW)).pendingRevision!;
    const second = (await requestRevision(w.farmer, lot.id, { ...change, askKobo: 5_200_000 }, NOW))
      .pendingRevision!;
    expect(second.id).not.toBe(first.id);
    const old = await prisma.lotRevision.findUniqueOrThrow({ where: { id: first.id } });
    expect(old.status).toBe("SUPERSEDED");
    await expect(decideRevision(w.officer, first.id, { approve: true }, NOW)).rejects.toMatchObject({
      code: "REVISION_NOT_PENDING",
    });
  });

  it("applies the self-approval rule to revisions", async () => {
    const lot = await liveLot();
    const self = await officerMember(w.farmer.userId, w.cooperativeId);
    const revision = (await requestRevision(w.farmer, lot.id, change, NOW)).pendingRevision!;
    await expect(decideRevision(self, revision.id, { approve: true }, NOW)).rejects.toMatchObject({
      code: "CANNOT_APPROVE_OWN_LOT",
    });
  });

  it("rejects a change with a reason and leaves the lot as it was", async () => {
    const lot = await liveLot();
    const revision = (await requestRevision(w.farmer, lot.id, change, NOW)).pendingRevision!;
    await expect(decideRevision(w.officer, revision.id, { approve: false }, NOW)).rejects.toMatchObject({
      code: "REASON_REQUIRED",
    });
    await decideRevision(w.officer, revision.id, { approve: false, reason: "Price too high for now" }, NOW);
    expect(await getOwnLot(w.farmer, lot.id)).toMatchObject({ askKobo: 5_000_000, pendingRevision: null });
  });

  it("refuses an invalid change", async () => {
    const lot = await liveLot();
    await expect(
      requestRevision(w.farmer, lot.id, { ...change, floorKobo: 6_000_000 }, NOW),
    ).rejects.toMatchObject({ code: "FLOOR_ABOVE_ASK" });
    await expect(requestRevision(w.farmer, lot.id, { ...change, quantity: 4 }, NOW)).rejects.toMatchObject({
      code: "QUANTITY_BELOW_MIN_ORDER",
    });
    const pending = await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    await expect(requestRevision(w.farmer, pending.id, change, NOW)).rejects.toMatchObject({
      code: "LOT_NOT_LIVE",
    });
  });
});

describe("withdrawing a lot", () => {
  it("withdraws a live lot and supersedes its pending change", async () => {
    const lot = await liveLot();
    const revision = (await requestRevision(w.farmer, lot.id, change, NOW)).pendingRevision!;
    expect((await withdrawLot(w.farmer, lot.id)).status).toBe("WITHDRAWN");
    const row = await prisma.lotRevision.findUniqueOrThrow({ where: { id: revision.id } });
    expect(row.status).toBe("SUPERSEDED");
  });

  it("withdraws a lot still waiting for screening", async () => {
    const lot = await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    expect((await withdrawLot(w.farmer, lot.id)).status).toBe("WITHDRAWN");
    await expect(approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW)).rejects.toMatchObject({
      code: "LOT_NOT_PENDING",
    });
  });

  it("refuses a rejected lot and a lot with open orders", async () => {
    const rejected = await submitLot(w.farmer, w.input(), [PHOTO], NOW);
    await rejectLot(w.officer, rejected.id, { reason: "Photos are unclear" });
    await expect(withdrawLot(w.farmer, rejected.id)).rejects.toMatchObject({ code: "LOT_NOT_WITHDRAWABLE" });

    const lot = await liveLot();
    guard.open = true;
    await expect(withdrawLot(w.farmer, lot.id)).rejects.toMatchObject({ code: "LOT_HAS_OPEN_ORDERS" });
  });
});
