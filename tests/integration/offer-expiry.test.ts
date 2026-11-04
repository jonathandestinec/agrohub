import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/[job]/route";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getJob } from "@/lib/jobs/registry";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import {
  expireOffers,
  getOwnOffer,
  makeOffer,
  respondToCounter,
  respondToOffer,
} from "@/modules/marketplace/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

const HOUR = 3_600_000;
let w: LotWorld;
let lotId: string;

const at = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
  const lot = await submitLot(w.farmer, w.input({ askKobo: 6_500_000, floorKobo: 5_500_000 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
  lotId = lot.id;
});

afterAll(cleanDatabase);

async function buyer(id: string): Promise<Actor> {
  return buyerMember(id);
}

describe("expireOffers", () => {
  it("expires open, referred and countered offers after 48 hours, once", async () => {
    const open = await makeOffer(await buyer("u-b1"), { lotId, quantity: 2, offeredKobo: 6_000_000 }, NOW);
    const referred = await makeOffer(await buyer("u-b2"), { lotId, quantity: 2, offeredKobo: 5_000_000 }, NOW);
    await respondToOffer(w.officer, referred.id, { decision: "ACCEPT" }, at(HOUR));
    const countered = await makeOffer(await buyer("u-b3"), { lotId, quantity: 2, offeredKobo: 5_000_000 }, at(-HOUR));
    await respondToOffer(w.officer, countered.id, { decision: "COUNTER", counterKobo: 6_000_000 }, at(HOUR));
    const fresh = await makeOffer(await buyer("u-b4"), { lotId, quantity: 2, offeredKobo: 6_000_000 }, at(2 * HOUR));

    const since = new Date();
    expect(await expireOffers(at(49 * HOUR))).toBe(3);
    const statuses = await prisma.offer.findMany({ select: { id: true, status: true } });
    const byId = Object.fromEntries(statuses.map((s) => [s.id, s.status]));
    expect(byId[open.id]).toBe("EXPIRED");
    expect(byId[referred.id]).toBe("EXPIRED");
    expect(byId[countered.id]).toBe("EXPIRED");
    expect(byId[fresh.id]).toBe("OPEN");
    const rows = await prisma.auditLog.findMany({ where: { action: "offer.expire", createdAt: { gte: since } } });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => (r.meta as { fromStatus: string }).fromStatus).sort()).toEqual([
      "AWAITING_FARMER",
      "COUNTERED",
      "OPEN",
    ]);
    expect(await expireOffers(at(49 * HOUR))).toBe(0);
  });

  it("leaves an offer younger than 48 hours alone", async () => {
    await makeOffer(await buyer("u-b1"), { lotId, quantity: 2, offeredKobo: 6_000_000 }, NOW);
    expect(await expireOffers(at(47 * HOUR))).toBe(0);
  });

  it("expires an accepted offer once its 24 hours to pay have passed", async () => {
    const b = await buyer("u-b1");
    const offer = await makeOffer(b, { lotId, quantity: 2, offeredKobo: 6_000_000 }, NOW);
    await respondToOffer(w.officer, offer.id, { decision: "ACCEPT" }, NOW);
    expect(await expireOffers(at(23 * HOUR))).toBe(0);
    expect(await expireOffers(at(25 * HOUR))).toBe(1);
    expect((await getOwnOffer(b, offer.id, at(25 * HOUR))).status).toBe("EXPIRED");
  });

  it("expires live offers on a lot that is no longer on sale", async () => {
    await makeOffer(await buyer("u-b1"), { lotId, quantity: 2, offeredKobo: 6_000_000 }, NOW);
    await prisma.lot.update({ where: { id: lotId }, data: { status: "WITHDRAWN" } });
    expect(await expireOffers(at(HOUR))).toBe(1);
  });

  it("expired_offer_cannot_be_accepted_before_job_runs", async () => {
    const b1 = await buyer("u-b1");
    const open = await makeOffer(b1, { lotId, quantity: 2, offeredKobo: 6_000_000 }, NOW);
    await expect(respondToOffer(w.officer, open.id, { decision: "ACCEPT" }, at(49 * HOUR))).rejects.toMatchObject({
      code: "OFFER_EXPIRED",
    });
    expect((await getOwnOffer(b1, open.id, at(49 * HOUR))).status).toBe("EXPIRED");

    const b2 = await buyer("u-b2");
    const countered = await makeOffer(b2, { lotId, quantity: 2, offeredKobo: 5_000_000 }, NOW);
    await respondToOffer(w.officer, countered.id, { decision: "COUNTER", counterKobo: 6_000_000 }, NOW);
    await expect(respondToCounter(b2, countered.id, true, at(49 * HOUR))).rejects.toMatchObject({
      code: "OFFER_EXPIRED",
    });
    expect(await prisma.offer.count({ where: { status: "ACCEPTED" } })).toBe(0);
  });

  it("is registered as the offer-expiry cron job", async () => {
    await import("@/lib/jobs");
    expect(getJob("offer-expiry")).toBeTypeOf("function");
    const response = await GET(
      new Request("http://localhost:3000/api/cron/offer-expiry", {
        headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      }),
      { params: Promise.resolve({ job: "offer-expiry" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: expect.stringMatching(/^(ran|skipped)$/) });
  });
});
