import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/[job]/route";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { addDays, lagosDateKey } from "@/lib/lagos-date";
import { getJob } from "@/lib/jobs/registry";
import { fakeStorage } from "@/lib/storage";
import { approveLot, expireLots, requestRevision, submitLot } from "@/modules/catalog/service";
import { cleanDatabase } from "./helpers";
import { lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

let w: LotWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
});

afterAll(async () => {
  await cleanDatabase();
});

describe("lot expiry", () => {
  it("expires live and pending lots whose date has passed, once", async () => {
    const today = lagosDateKey(NOW);
    const until = addDays(today, 2);
    const liveLot = await submitLot(w.farmer, w.input({ availableUntil: until }), [PHOTO], NOW);
    await approveLot(w.officer, liveLot.id, { minOrderQty: 1 }, NOW);
    await requestRevision(w.farmer, liveLot.id, { askKobo: 6_400_000, quantity: 30, floorKobo: 6_000_000 }, NOW);
    const pending = await submitLot(w.farmer, w.input({ availableUntil: until }), [PHOTO], NOW);
    const later = await submitLot(w.farmer, w.input({ availableUntil: addDays(today, 3) }), [PHOTO], NOW);

    const dayAfter = new Date(`${addDays(until, 1)}T08:00:00Z`);
    const started = new Date();
    expect(await expireLots(dayAfter)).toBe(2);
    const statuses = await prisma.lot.findMany({ select: { id: true, status: true } });
    expect(Object.fromEntries(statuses.map((l) => [l.id, l.status]))).toEqual({
      [liveLot.id]: "EXPIRED",
      [pending.id]: "EXPIRED",
      [later.id]: "PENDING_REVIEW",
    });
    expect(await prisma.lotRevision.count({ where: { status: "PENDING" } })).toBe(0);
    const audit = await prisma.auditLog.findMany({
      where: { action: "lot.expire", createdAt: { gte: started } },
    });
    expect(audit.map((a) => a.entityId).sort()).toEqual([liveLot.id, pending.id].sort());
    expect(audit.every((a) => a.actorId === null)).toBe(true);

    expect(await expireLots(dayAfter)).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "lot.expire", createdAt: { gte: started } } })).toBe(2);
  });

  it("leaves a lot alone on its last day", async () => {
    const until = addDays(lagosDateKey(NOW), 2);
    await submitLot(w.farmer, w.input({ availableUntil: until }), [PHOTO], NOW);
    expect(await expireLots(new Date(`${until}T22:00:00Z`))).toBe(0);
  });

  it("is registered as the lot-expiry cron job", async () => {
    await import("@/lib/jobs");
    expect(getJob("lot-expiry")).toBeTypeOf("function");
    const response = await GET(
      new Request("http://localhost:3000/api/cron/lot-expiry", {
        headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      }),
      { params: Promise.resolve({ job: "lot-expiry" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: expect.stringMatching(/^(ran|skipped)$/) });
  });
});
