import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack, fakeSettle, fakeWebhook } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { approveLot, searchLiveLots, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { getOwnOffer, makeOffer, respondToOffer } from "@/modules/marketplace/service";
import { startCheckout } from "@/modules/orders/service";
import { confirmPayment, handlePaystackWebhook, ledgerBalance } from "@/modules/payments/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

const MIN = 60_000;
let w: LotWorld;
let a: Actor;
let b: Actor;
let lotId: string;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  w = await lotWorld();
  a = await buyerMember("u-a");
  b = await buyerMember("u-b");
});

afterAll(cleanDatabase);

async function liveLot(quantity: number, askKobo = 6_500_000, cut = false): Promise<string> {
  if (cut) await prisma.cooperative.update({ where: { id: w.cooperativeId }, data: { cutBps: 0 } });
  const lot = await submitLot(w.farmer, w.input({ quantity, askKobo, floorKobo: askKobo - 100 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
  return lot.id;
}

async function checkout(who: Actor, quantity: number, when: Date) {
  const { orderId } = await startCheckout(who, { source: "LOT", lotId, quantity }, when);
  const { reference } = await prisma.payment.findFirstOrThrow({ where: { orderId } });
  return { orderId, reference };
}

const order = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, include: { refunds: true } });

describe("confirmPayment", () => {
  it("concurrent_last_unit_refunds_later_payment", async () => {
    lotId = await liveLot(10);
    const t0 = new Date(Date.now() - 20 * MIN);
    const first = await checkout(a, 10, t0);
    const second = await checkout(b, 10, new Date(t0.getTime() + 16 * MIN));
    const late = fakeSettle(first.reference, "success");
    const prompt = fakeSettle(second.reference, "success");
    expect(await handlePaystackWebhook(prompt.rawBody, prompt.signature)).toMatchObject({ outcome: "PAID" });
    expect(await handlePaystackWebhook(late.rawBody, late.signature)).toMatchObject({ outcome: "REFUNDING" });
    expect((await order(second.orderId)).status).toBe("PAID_HELD");
    const refunded = await order(first.orderId);
    expect(refunded).toMatchObject({ status: "REFUNDED", cancelReason: "LATE_PAYMENT" });
    expect(refunded.refunds).toHaveLength(1);
    expect(refunded.refunds[0]).toMatchObject({ reason: "LATE_PAYMENT", amountKobo: BigInt(65_000_000), status: "PENDING" });
    expect(fakePaystack.refunds).toEqual([{ reference: first.reference, amountKobo: 65_000_000, refundId: refunded.refunds[0].paystackRefundId }]);
    expect(await handlePaystackWebhook(late.rawBody, late.signature)).toMatchObject({ outcome: "DUPLICATE" });
    expect(await confirmPayment(first.reference)).toBe("ALREADY_CONFIRMED");
    expect(fakePaystack.refunds).toHaveLength(1);
  });

  it("accepts a late payment on an expired order while its stock is still free", async () => {
    lotId = await liveLot(30);
    const { orderId, reference } = await checkout(a, 10, new Date(Date.now() - 30 * 3_600_000));
    await prisma.order.update({ where: { id: orderId }, data: { status: "CANCELLED", cancelReason: "PAYMENT_EXPIRED" } });
    fakeSettle(reference, "success");
    expect(await confirmPayment(reference)).toBe("PAID");
    expect(await order(orderId)).toMatchObject({ status: "PAID_HELD", cancelReason: null });
  });

  it("paying an accepted offer's order makes the offer ORDERED", async () => {
    lotId = await liveLot(30);
    const offer = await makeOffer(a, { lotId, quantity: 12, offeredKobo: 6_500_000 }, new Date());
    await respondToOffer(w.officer, offer.id, { decision: "ACCEPT" }, new Date());
    const { orderId } = await startCheckout(a, { source: "OFFER", offerId: offer.id }, new Date());
    const { reference } = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    fakeSettle(reference, "success");
    expect(await confirmPayment(reference)).toBe("PAID");
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("ORDERED");
    expect((await getOwnOffer(a, offer.id)).status).toBe("ORDERED");
  });

  it("buying the whole lot makes it SOLD_OUT and it leaves the search", async () => {
    lotId = await liveLot(10);
    const { reference } = await checkout(a, 10, new Date());
    fakeSettle(reference, "success");
    await confirmPayment(reference);
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: lotId } })).status).toBe("SOLD_OUT");
    expect((await searchLiveLots({ sort: "newest", page: 1 })).lots.map((l) => l.id)).not.toContain(lotId);
  });

  it("a refund.processed webhook settles the refund once", async () => {
    lotId = await liveLot(10);
    const t0 = new Date(Date.now() - 20 * MIN);
    const first = await checkout(a, 10, t0);
    const second = await checkout(b, 10, new Date(t0.getTime() + 16 * MIN));
    fakeSettle(second.reference, "success");
    await confirmPayment(second.reference);
    fakeSettle(first.reference, "success");
    await confirmPayment(first.reference);
    const refund = (await order(first.orderId)).refunds[0];
    const processed = fakeWebhook({ event: "refund.processed", data: { id: refund.paystackRefundId, status: "processed", amount: 65_000_000, transaction_reference: first.reference } });
    expect(await handlePaystackWebhook(processed.rawBody, processed.signature)).toMatchObject({ outcome: "SETTLED" });
    expect((await order(first.orderId)).refunds[0].status).toBe("PROCESSED");
    expect(await ledgerBalance(first.orderId, "REFUND_PAYABLE")).toBe(0);
  });

  it("fifty_million_naira_order_is_exact", async () => {
    lotId = await liveLot(100, 50_000_000, true);
    const { orderId, reference } = await checkout(a, 100, new Date());
    expect((await order(orderId)).totalKobo).toBe(BigInt("5000000000"));
    expect(fakePaystack.transactions.get(reference)?.amountKobo).toBe(5_000_000_000);
    fakeSettle(reference, "success");
    expect(await confirmPayment(reference)).toBe("PAID");
    expect(await ledgerBalance(orderId, "HELD")).toBe(-5_000_000_000);
  });
});
