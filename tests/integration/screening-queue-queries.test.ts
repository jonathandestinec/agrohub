import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeStorage } from "@/lib/storage";
import { listScreeningQueue, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { cleanDatabase, createTestCooperative } from "./helpers";
import { farmerMember, lotWorld, NOW, officerMember, PHOTO, type LotWorld } from "./lot-fixtures";
import { countQueries } from "./query-count";

let w: LotWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
});

afterAll(async () => {
  await cleanDatabase();
});

const PHOTO_2 = { ...PHOTO, body: Buffer.concat([PHOTO.body, Buffer.from([1])]) };

// A cooperative whose only officer is the farmer, so its lots wait for an admin.
async function soloCooperativeLot(n: number): Promise<string> {
  const cooperativeId = (await createTestCooperative({ name: `Solo ${n}`, status: "VERIFIED" })).id;
  const farmer = await farmerMember(`u-solo-${n}`, cooperativeId);
  await officerMember(farmer.userId, cooperativeId);
  return (await submitLot(farmer, w.input(), [PHOTO, PHOTO_2], NOW)).id;
}

async function officerLots(count: number, farmer: Actor = w.farmer): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push((await submitLot(farmer, w.input(), [PHOTO, PHOTO_2], NOW)).id);
  return ids;
}

// Prisma sends one statement per included relation, so even an empty queue is several
// statements. The queue may add at most two batched ones (officers, photos) on top.
async function emptyCost(actor: Actor): Promise<number> {
  const { result, queries } = await countQueries(() => listScreeningQueue(actor));
  expect(result).toEqual([]);
  return queries;
}

describe("screening queue query count", () => {
  it("admin queue costs the same for one lot as for many", async () => {
    const empty = await emptyCost(w.admin);
    // A lot in a cooperative with another officer: the admin never sees it.
    await officerLots(1);
    await soloCooperativeLot(1);
    const one = await countQueries(() => listScreeningQueue(w.admin));
    expect(one.result).toHaveLength(1);

    for (let n = 2; n <= 5; n++) await soloCooperativeLot(n);
    const many = await countQueries(() => listScreeningQueue(w.admin));
    expect(many.result).toHaveLength(5);

    expect(many.queries).toBe(one.queries);
    expect(many.queries).toBeLessThanOrEqual(empty + 2);
  });

  it("officer queue costs the same for one lot as for many", async () => {
    const empty = await emptyCost(w.officer);
    await officerLots(1);
    const one = await countQueries(() => listScreeningQueue(w.officer));
    expect(one.result).toHaveLength(1);

    await officerLots(4);
    const many = await countQueries(() => listScreeningQueue(w.officer));
    expect(many.result).toHaveLength(5);

    expect(many.queries).toBe(one.queries);
    expect(many.queries).toBeLessThanOrEqual(empty + 2);
  });
});

describe("screening queue output", () => {
  it("keeps each lot's photos in order and marks approval per lot", async () => {
    const [first, second] = await officerLots(2);
    const self = await officerMember(w.farmer.userId, w.cooperativeId);
    const queue = await listScreeningQueue(self);
    expect(queue.map((l) => [l.id, l.canApprove, l.photoUrls.length])).toEqual([
      [first, false, 2],
      [second, false, 2],
    ]);

    const officerView = await listScreeningQueue(w.officer);
    expect(officerView.map((l) => l.canApprove)).toEqual([true, true]);
    for (const lot of officerView) {
      const keys = await prisma.lotPhoto.findMany({ where: { lotId: lot.id }, orderBy: { position: "asc" } });
      expect(lot.photoUrls).toHaveLength(keys.length);
      keys.forEach((k, i) => expect(lot.photoUrls[i]).toContain(k.storageKey));
    }
  });

  it("shows the admin only lots no other officer can screen, all approvable", async () => {
    await officerLots(1);
    const solo = [await soloCooperativeLot(1), await soloCooperativeLot(2)];
    const queue = await listScreeningQueue(w.admin);
    expect(queue.map((l) => [l.id, l.canApprove])).toEqual(solo.map((id) => [id, true]));
  });
});
