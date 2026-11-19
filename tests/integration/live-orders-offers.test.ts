import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { lagosDateKey } from "@/lib/lagos-date";
import { fakeStorage } from "@/lib/storage";
import type { Actor } from "@/modules/identity/policies";
import { readTopics } from "@/modules/live/service";
import { makeOffer, offerVersion, offersListVersion, respondToOffer, withdrawOffer } from "@/modules/marketplace/service";
import { openLotThread, postMessage } from "@/modules/messaging/service";
import {
  cancelOrder,
  confirmReceipt,
  markDelivered,
  orderVersion,
  ordersListVersion,
  reportProblem,
  resolveDispute,
  setDeliveryDate,
  startCheckout,
  startPreparing,
} from "@/modules/orders/service";
import { cleanDatabase, createTestCooperative } from "./helpers";
import { buyerMember, officerMember } from "./lot-fixtures";
import { paidOrder, paidWorld, type PaidWorld } from "./paid-order";

const pause = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

let w: PaidWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await paidWorld();
});

afterAll(cleanDatabase);

// Runs `change`, and says whether the version moved.
async function moves(read: () => Promise<string>, change: () => Promise<unknown>): Promise<boolean> {
  const before = await read();
  await pause();
  await change();
  return (await read()) !== before;
}

describe("orderVersion", () => {
  it("changes_at_every_step_the_officer_and_buyer_take", async () => {
    const { orderId } = await paidOrder(w, 10);
    const read = () => orderVersion(w.buyer, orderId);
    expect(await read()).toBe(await read());
    expect(await moves(read, () => startPreparing(w.officer, orderId))).toBe(true);
    expect(await moves(read, () => setDeliveryDate(w.officer, orderId, lagosDateKey(new Date(Date.now() + 86_400_000))))).toBe(true);
    expect(await moves(read, () => markDelivered(w.officer, orderId, 10))).toBe(true);
    expect(await moves(read, () => confirmReceipt(w.buyer, orderId))).toBe(true);
  });

  it("the_officers_version_moves_with_the_buyers_steps_too", async () => {
    const { orderId } = await paidOrder(w, 10);
    const read = () => orderVersion(w.officer, orderId);
    expect(await moves(read, () => cancelOrder(w.buyer, orderId, "Changed my mind"))).toBe(true);
  });

  it("changes_when_the_cooperative_cancels_and_a_refund_is_written", async () => {
    const { orderId } = await paidOrder(w, 10);
    const read = () => orderVersion(w.buyer, orderId);
    expect(await moves(read, () => cancelOrder(w.officer, orderId, "Lot spoiled"))).toBe(true);
  });

  it("changes_when_a_message_is_added_to_the_buyers_thread", async () => {
    const { orderId } = await paidOrder(w, 10);
    const read = () => orderVersion(w.buyer, orderId);
    const { threadId } = await openLotThread(w.buyer, w.lotId, new Date());
    expect(await moves(read, () => postMessage(w.officer, threadId, "We will deliver on Friday.", new Date()))).toBe(true);
  });

  it("changes_on_a_report_and_on_a_decision_that_does_not_touch_the_order", async () => {
    const { orderId } = await paidOrder(w, 10);
    await startPreparing(w.officer, orderId);
    await markDelivered(w.officer, orderId, 10);
    await confirmReceipt(w.buyer, orderId);
    const read = () => orderVersion(w.buyer, orderId);
    // A report after completion adds a dispute and leaves the order row alone.
    const orderBefore = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(await moves(read, () => reportProblem(w.buyer, orderId, "Half the bags were wet", new Date()))).toBe(true);
    const afterReport = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(afterReport.updatedAt).toEqual(orderBefore.updatedAt);
    // A note decision closes the dispute, again leaving the order row alone.
    const dispute = await prisma.dispute.findFirstOrThrow({ where: { orderId } });
    expect(await moves(read, () => resolveDispute(w.admin, dispute.id, { outcome: "NOTE", note: "Noted." }, new Date()))).toBe(true);
    const afterNote = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(afterNote.updatedAt).toEqual(orderBefore.updatedAt);
  });

  it("the_buyer_can_read_an_unpaid_order_but_the_officer_cannot", async () => {
    const { orderId } = await startCheckout(w.buyer, { source: "LOT", lotId: w.lotId, quantity: 5 }, new Date());
    expect(await orderVersion(w.buyer, orderId)).toEqual(expect.any(String));
    await expect(orderVersion(w.officer, orderId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("looks_missing_to_everyone_else", async () => {
    const { orderId } = await paidOrder(w, 10);
    const otherBuyer = await buyerMember("u-buyer-2");
    const other = await createTestCooperative({ name: "Other cooperative" });
    const otherOfficer = await officerMember("u-officer-other", other.id);
    for (const stranger of [otherBuyer, otherOfficer, w.farmer, w.admin]) {
      await expect(orderVersion(stranger, orderId)).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(orderVersion(w.buyer, "no-such-order")).rejects.toBeInstanceOf(NotFoundError);
    const answers = await readTopics(otherBuyer, [{ key: `order:${orderId}` }]);
    expect(answers[`order:${orderId}`]).toEqual({ error: "not_found" });
  });
});

describe("ordersListVersion", () => {
  it("moves_for_the_buyer_and_officer_when_an_order_changes_and_not_for_others", async () => {
    const otherBuyer = await buyerMember("u-buyer-2");
    const other = await createTestCooperative({ name: "Other cooperative" });
    const otherOfficer = await officerMember("u-officer-other", other.id);
    const otherBefore = [await ordersListVersion(otherBuyer), await ordersListVersion(otherOfficer)];
    const buyerRead = () => ordersListVersion(w.buyer);
    const officerRead = () => ordersListVersion(w.officer);
    const [buyerBefore, officerBefore] = [await buyerRead(), await officerRead()];
    await pause();
    const { orderId } = await paidOrder(w, 10);
    expect(await buyerRead()).not.toBe(buyerBefore);
    expect(await officerRead()).not.toBe(officerBefore);
    expect(await moves(buyerRead, () => startPreparing(w.officer, orderId))).toBe(true);
    expect(await moves(officerRead, () => markDelivered(w.officer, orderId, 10))).toBe(true);
    expect([await ordersListVersion(otherBuyer), await ordersListVersion(otherOfficer)]).toEqual(otherBefore);
  });

  it("is_forbidden_for_a_farmer_and_an_admin", async () => {
    await expect(ordersListVersion(w.farmer)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ordersListVersion(w.admin)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("offerVersion", () => {
  const offer = (actor: Actor = w.buyer) => makeOffer(actor, { lotId: w.lotId, quantity: 10, offeredKobo: 6_499_950 }, new Date());

  it("changes_when_the_officer_answers_and_when_the_buyer_withdraws", async () => {
    const { id } = await offer();
    const read = () => offerVersion(w.buyer, id);
    expect(await read()).toBe(await read());
    expect(await moves(read, () => respondToOffer(w.officer, id, { decision: "REJECT" }))).toBe(true);

    const second = await offer();
    expect(await moves(() => offerVersion(w.officer, second.id), () => withdrawOffer(w.buyer, second.id))).toBe(true);
  });

  it("changes_when_a_message_is_added_to_the_buyers_thread", async () => {
    const { id } = await offer();
    const { threadId } = await openLotThread(w.buyer, w.lotId, new Date());
    expect(
      await moves(
        () => offerVersion(w.buyer, id),
        () => postMessage(w.officer, threadId, "Could you do 8 bags?", new Date()),
      ),
    ).toBe(true);
  });

  it("looks_missing_to_everyone_else", async () => {
    const { id } = await offer();
    const otherBuyer = await buyerMember("u-buyer-2");
    const other = await createTestCooperative({ name: "Other cooperative" });
    const otherOfficer = await officerMember("u-officer-other", other.id);
    for (const stranger of [otherBuyer, otherOfficer, w.farmer, w.admin]) {
      await expect(offerVersion(stranger, id)).rejects.toBeInstanceOf(NotFoundError);
    }
    const answers = await readTopics(otherBuyer, [{ key: `offer:${id}` }]);
    expect(answers[`offer:${id}`]).toEqual({ error: "not_found" });
  });
});

describe("offersListVersion", () => {
  it("moves_for_the_buyer_the_officer_and_the_lots_farmer_but_not_for_others", async () => {
    const otherBuyer = await buyerMember("u-buyer-2");
    const other = await createTestCooperative({ name: "Other cooperative" });
    const otherOfficer = await officerMember("u-officer-other", other.id);
    const before = {
      buyer: await offersListVersion(w.buyer),
      officer: await offersListVersion(w.officer),
      farmer: await offersListVersion(w.farmer),
      otherBuyer: await offersListVersion(otherBuyer),
      otherOfficer: await offersListVersion(otherOfficer),
    };
    await pause();
    const made = await makeOffer(w.buyer, { lotId: w.lotId, quantity: 10, offeredKobo: 6_499_950 }, new Date());
    expect(await offersListVersion(w.buyer)).not.toBe(before.buyer);
    expect(await offersListVersion(w.officer)).not.toBe(before.officer);
    expect(await offersListVersion(w.farmer)).not.toBe(before.farmer);
    expect(await offersListVersion(otherBuyer)).toBe(before.otherBuyer);
    expect(await offersListVersion(otherOfficer)).toBe(before.otherOfficer);

    const afterMake = await offersListVersion(w.buyer);
    await pause();
    await respondToOffer(w.officer, made.id, { decision: "REJECT" });
    expect(await offersListVersion(w.buyer)).not.toBe(afterMake);
  });

  it("is_forbidden_for_an_admin", async () => {
    await expect(offersListVersion(w.admin)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
