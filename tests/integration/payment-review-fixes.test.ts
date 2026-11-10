import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack, fakeSettle, fakeWebhook } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { makeOffer, respondToOffer } from "@/modules/marketplace/service";
import { startCheckout } from "@/modules/orders/service";
import { handlePaystackWebhook, ledgerBalance } from "@/modules/payments/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

const MIN = 60_000;
let w: LotWorld;
let buyer: Actor;
let other: Actor;
let lotId: string;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  w = await lotWorld();
  buyer = await buyerMember("u-buyer");
  other = await buyerMember("u-other");
  const lot = await submitLot(w.farmer, w.input({ quantity: 30 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
  lotId = lot.id;
});

afterAll(cleanDatabase);

const referenceOf = async (orderId: string) => (await prisma.payment.findFirstOrThrow({ where: { orderId } })).reference;
const statusOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;

async function lateRefundedOrder(): Promise<{ orderId: string; reference: string }> {
  await prisma.lot.update({ where: { id: lotId }, data: { quantity: 10 } });
  const t0 = new Date(Date.now() - 20 * MIN);
  const first = await startCheckout(buyer, { source: "LOT", lotId, quantity: 10 }, t0);
  const second = await startCheckout(other, { source: "LOT", lotId, quantity: 10 }, new Date(t0.getTime() + 16 * MIN));
  const prompt = fakeSettle(await referenceOf(second.orderId), "success");
  await handlePaystackWebhook(prompt.rawBody, prompt.signature);
  return { orderId: first.orderId, reference: await referenceOf(first.orderId) };
}

describe("review fixes for Phase 5a", () => {
  it("an_accepted_offer_paid_twice_refunds_the_second_payment", async () => {
    const offer = await makeOffer(buyer, { lotId, quantity: 12, offeredKobo: 6_500_000 }, new Date());
    await respondToOffer(w.officer, offer.id, { decision: "ACCEPT" }, new Date());
    const first = await startCheckout(buyer, { source: "OFFER", offerId: offer.id }, new Date());
    const second = await startCheckout(buyer, { source: "OFFER", offerId: offer.id }, new Date());
    const a = fakeSettle(await referenceOf(second.orderId), "success");
    const b = fakeSettle(await referenceOf(first.orderId), "success");
    expect(await handlePaystackWebhook(a.rawBody, a.signature)).toMatchObject({ outcome: "PAID" });
    expect(await handlePaystackWebhook(b.rawBody, b.signature)).toMatchObject({ outcome: "REFUNDING" });
    expect(await statusOf(second.orderId)).toBe("PAID_HELD");
    expect(await statusOf(first.orderId)).toBe("REFUNDED");
    expect(fakePaystack.refunds.map((r) => r.reference)).toEqual([await referenceOf(first.orderId)]);
  });

  it("a_webhook_left_processing_by_a_killed_function_is_processed_on_redelivery", async () => {
    const { orderId } = await startCheckout(buyer, { source: "LOT", lotId, quantity: 5 }, new Date());
    const { rawBody, signature } = fakeSettle(await referenceOf(orderId), "success");
    const id = JSON.parse(rawBody).data.id;
    await prisma.paystackEvent.create({
      data: { eventKey: `charge.success:${id}`, event: "charge.success", payload: {}, outcome: "PROCESSING", claimedAt: new Date(Date.now() - 10 * MIN) },
    });
    expect(await handlePaystackWebhook(rawBody, signature)).toMatchObject({ status: 200, outcome: "PAID" });
    expect(await statusOf(orderId)).toBe("PAID_HELD");
  });

  it("a_webhook_being_processed_right_now_is_a_duplicate", async () => {
    const { orderId } = await startCheckout(buyer, { source: "LOT", lotId, quantity: 5 }, new Date());
    const { rawBody, signature } = fakeSettle(await referenceOf(orderId), "success");
    const id = JSON.parse(rawBody).data.id;
    await prisma.paystackEvent.create({
      data: { eventKey: `charge.success:${id}`, event: "charge.success", payload: {}, outcome: "PROCESSING", claimedAt: new Date(Date.now() - MIN) },
    });
    expect(await handlePaystackWebhook(rawBody, signature)).toMatchObject({ status: 200, outcome: "DUPLICATE" });
  });

  it("a_refund_webhook_without_an_id_and_with_a_string_amount_settles_by_transaction_reference", async () => {
    const { orderId, reference } = await lateRefundedOrder();
    const late = fakeSettle(reference, "success");
    await handlePaystackWebhook(late.rawBody, late.signature);
    const processed = fakeWebhook({
      event: "refund.processed",
      data: { status: "processed", transaction_reference: reference, refund_reference: null, amount: "65000000", currency: "NGN" },
    });
    expect(await handlePaystackWebhook(processed.rawBody, processed.signature)).toMatchObject({ status: 200, outcome: "SETTLED" });
    expect((await prisma.refund.findFirstOrThrow({ where: { orderId } })).status).toBe("PROCESSED");
    expect(await ledgerBalance(orderId, "REFUND_PAYABLE")).toBe(0);
  });

  it("a_late_refund_paystack_could_not_take_is_sent_on_the_next_delivery", async () => {
    const { orderId, reference } = await lateRefundedOrder();
    const late = fakeSettle(reference, "success");
    fakePaystack.failNextRefund = true;
    await handlePaystackWebhook(late.rawBody, late.signature);
    const pending = await prisma.refund.findFirstOrThrow({ where: { orderId } });
    expect(pending).toMatchObject({ status: "PENDING", paystackRefundId: null });
    expect(fakePaystack.refunds).toHaveLength(0);
    // Paystack delivers charge.success again (or reconciliation re-confirms): the refund goes out.
    const again = fakeWebhook({ ...JSON.parse(late.rawBody), event: "charge.success", data: { ...JSON.parse(late.rawBody).data, id: 424242 } });
    await handlePaystackWebhook(again.rawBody, again.signature);
    expect(fakePaystack.refunds.map((r) => r.reference)).toEqual([reference]);
    expect((await prisma.refund.findFirstOrThrow({ where: { orderId } })).paystackRefundId).not.toBeNull();
  });
});
