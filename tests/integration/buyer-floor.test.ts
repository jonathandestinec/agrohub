import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeStorage } from "@/lib/storage";
import { approveLot, getPublicLot, parseLotFilters, searchLiveLots, submitLot } from "@/modules/catalog/service";
import { getPublicCooperative } from "@/modules/cooperatives/service";
import type { Actor } from "@/modules/identity/policies";
import {
  farmerRespondToOffer,
  getOwnOffer,
  listOwnOffers,
  makeOffer,
  respondToCounter,
  respondToOffer,
  withdrawOffer,
} from "@/modules/marketplace/service";
import { getThread, listOwnThreads, openLotThread, postMessage } from "@/modules/messaging/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

// The roadmap's Review Focus 4: the floor must not reach a buyer in any response, error or
// message. Floor ₦43,219.87, ask ₦65,000.
const FLOOR = 4_321_987;
const ASK = 6_500_000;
const HOUR = 3_600_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

let w: LotWorld;
let lotId: string;
const seen: string[] = [];

// Records what a buyer-callable function returned or threw, as the buyer would receive it.
async function asBuyer<T>(call: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await call();
    seen.push(JSON.stringify(value));
    return value;
  } catch (error) {
    const e = error as { name?: string; code?: string; message?: string };
    seen.push(JSON.stringify({ name: e.name, code: e.code, message: e.message }));
    return undefined;
  }
}

beforeAll(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await lotWorld();
  const lot = await submitLot(w.farmer, w.input({ askKobo: ASK, floorKobo: FLOOR, quantity: 30 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
  lotId = lot.id;
});

afterAll(cleanDatabase);

describe("buyer_responses_never_contain_floor", () => {
  it("leaves no trace of the floor in anything a buyer receives through a whole negotiation", async () => {
    const buyer: Actor = await buyerMember("u-buyer");
    const filters = parseLotFilters({});
    await asBuyer(() => searchLiveLots(filters, NOW));
    await asBuyer(() => getPublicLot(lotId, NOW));
    await asBuyer(() => getPublicCooperative(w.cooperativeId));

    // Refusals.
    await asBuyer(() => makeOffer(buyer, { lotId, quantity: 10, offeredKobo: ASK + 1 }, NOW));
    await asBuyer(() => makeOffer(buyer, { lotId, quantity: 4, offeredKobo: 4_000_000 }, NOW));
    await asBuyer(() => makeOffer(buyer, { lotId, quantity: 31, offeredKobo: 4_000_000 }, NOW));

    // Below the floor: referred to the farmer, who declines.
    const below = await asBuyer(() => makeOffer(buyer, { lotId, quantity: 10, offeredKobo: 4_000_000, message: "Best price?" }, NOW));
    await respondToOffer(w.officer, below!.id, { decision: "ACCEPT" }, at(HOUR));
    await asBuyer(() => getOwnOffer(buyer, below!.id, at(HOUR)));
    await asBuyer(() => listOwnOffers(buyer, at(HOUR)));
    await farmerRespondToOffer(w.farmer, below!.id, false, at(HOUR));
    await asBuyer(() => getOwnOffer(buyer, below!.id, at(HOUR)));

    // A counter the buyer accepts.
    const countered = await asBuyer(() => makeOffer(buyer, { lotId, quantity: 10, offeredKobo: 4_200_000 }, at(2 * HOUR)));
    await respondToOffer(w.officer, countered!.id, { decision: "COUNTER", counterKobo: 5_000_000, message: "We can do ₦50,000." }, at(2 * HOUR));
    await asBuyer(() => getOwnOffer(buyer, countered!.id, at(2 * HOUR)));
    await asBuyer(() => respondToCounter(buyer, countered!.id, true, at(3 * HOUR)));

    // An offer the buyer withdraws.
    const withdrawn = await asBuyer(() => makeOffer(buyer, { lotId, quantity: 5, offeredKobo: 4_300_000 }, at(4 * HOUR)));
    await asBuyer(() => withdrawOffer(buyer, withdrawn!.id, at(4 * HOUR)));
    await asBuyer(() => listOwnOffers(buyer, at(4 * HOUR)));

    // The thread, after the officer replied and after a refused floor message.
    const thread = await asBuyer(() => openLotThread(buyer, lotId, at(5 * HOUR)));
    await postMessage(w.officer, thread!.threadId, "Thanks for your interest.", at(5 * HOUR));
    await expect(postMessage(w.officer, thread!.threadId, "Our lowest is 43,219.87", at(5 * HOUR))).rejects.toMatchObject({
      code: "MESSAGE_MENTIONS_FLOOR",
    });
    await asBuyer(() => getThread(buyer, thread!.threadId));
    await asBuyer(() => listOwnThreads(buyer));
    await asBuyer(() => postMessage(buyer, thread!.threadId, "Thank you", at(5 * HOUR)));

    expect(seen.length).toBeGreaterThanOrEqual(18);
    for (const text of seen) {
      expect(text).not.toContain(String(FLOOR));
      expect(text).not.toContain("43219.87");
      expect(text).not.toContain("43,219.87");
      expect(text).not.toMatch(/floor/i);
      expect(text).not.toContain(w.farmer.userId);
      expect(text).not.toContain("Farmer u-farmer");
    }
  });
});
