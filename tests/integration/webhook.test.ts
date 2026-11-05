import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack, fakeSettle, fakeWebhook } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { startCheckout } from "@/modules/orders/service";
import { handlePaystackWebhook } from "@/modules/payments/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

let w: LotWorld;
let buyer: Actor;
let lotId: string;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  w = await lotWorld();
  buyer = await buyerMember("u-buyer");
  const lot = await submitLot(w.farmer, w.input({ quantity: 30 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
  lotId = lot.id;
});

afterAll(cleanDatabase);

async function checkout(quantity = 10): Promise<{ orderId: string; reference: string }> {
  const { orderId } = await startCheckout(buyer, { source: "LOT", lotId, quantity }, new Date());
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
  return { orderId, reference: payment.reference };
}

const orderStatus = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;

describe("handlePaystackWebhook", () => {
  it("bad_signature_is_401_and_records_nothing", async () => {
    const { orderId, reference } = await checkout();
    const { rawBody, signature } = fakeSettle(reference, "success");
    expect(await handlePaystackWebhook(rawBody, signature.replace(/.$/, (c) => (c === "0" ? "1" : "0")))).toMatchObject({ status: 401 });
    expect(await handlePaystackWebhook(rawBody, null)).toMatchObject({ status: 401 });
    expect(await prisma.paystackEvent.count()).toBe(0);
    expect(await orderStatus(orderId)).toBe("PENDING_PAYMENT");
  });

  it("marks the order paid after a signed charge.success that Paystack verifies", async () => {
    const { orderId, reference } = await checkout();
    const { rawBody, signature } = fakeSettle(reference, "success");
    expect(await handlePaystackWebhook(rawBody, signature)).toEqual({ status: 200, outcome: "PAID" });
    expect(await orderStatus(orderId)).toBe("PAID_HELD");
    expect(await prisma.payment.findFirstOrThrow({ where: { orderId } })).toMatchObject({ status: "SUCCEEDED", channel: "card" });
    expect(await prisma.stockReservation.count({ where: { orderId } })).toBe(0);
  });

  it("duplicate_webhook_creates_one_payment, delivered twice and twice at once", async () => {
    const { orderId, reference } = await checkout();
    const since = new Date();
    const { rawBody, signature } = fakeSettle(reference, "success");
    await handlePaystackWebhook(rawBody, signature);
    expect(await handlePaystackWebhook(rawBody, signature)).toEqual({ status: 200, outcome: "DUPLICATE" });
    const second = await checkout(5);
    const again = fakeSettle(second.reference, "success");
    const both = await Promise.all([handlePaystackWebhook(again.rawBody, again.signature), handlePaystackWebhook(again.rawBody, again.signature)]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    for (const id of [orderId, second.orderId]) {
      expect(await prisma.payment.count({ where: { orderId: id, status: "SUCCEEDED" } })).toBe(1);
      expect(await prisma.ledgerEntry.count({ where: { orderId: id, kind: "payment.captured" } })).toBe(2);
      expect(await prisma.auditLog.count({ where: { action: "order.paid", entityId: id, createdAt: { gte: since } } })).toBe(1);
    }
    expect(await prisma.paystackEvent.count()).toBe(2);
  });

  it("verify_disagrees_order_stays_unpaid", async () => {
    const { orderId, reference } = await checkout();
    const tx = fakePaystack.transactions.get(reference)!;
    const forged = fakeWebhook({ event: "charge.success", data: { id: Number(tx.transactionId), reference, status: "success", amount: 65_000_000, currency: "NGN" } });
    expect(await handlePaystackWebhook(forged.rawBody, forged.signature)).toEqual({ status: 200, outcome: "VERIFY_MISMATCH" });
    expect(await orderStatus(orderId)).toBe("PENDING_PAYMENT");
  });

  it("amount_mismatch_is_not_paid", async () => {
    const { orderId, reference } = await checkout();
    const { rawBody, signature } = fakeSettle(reference, "success", 65_000_000 - 100);
    expect(await handlePaystackWebhook(rawBody, signature)).toEqual({ status: 200, outcome: "VERIFY_MISMATCH" });
    expect(await orderStatus(orderId)).toBe("PENDING_PAYMENT");
  });

  it("answers 200 for an unknown reference and an unhandled event, recording both", async () => {
    const unknown = fakeWebhook({ event: "charge.success", data: { id: 77, reference: "pay_nobody", status: "success", amount: 1, currency: "NGN" } });
    expect(await handlePaystackWebhook(unknown.rawBody, unknown.signature)).toEqual({ status: 200, outcome: "UNKNOWN_REFERENCE" });
    const other = fakeWebhook({ event: "subscription.create", data: { id: 78 } });
    expect(await handlePaystackWebhook(other.rawBody, other.signature)).toEqual({ status: 200, outcome: "IGNORED" });
    expect(await prisma.paystackEvent.count()).toBe(2);
  });

  it("answers 400 to a signed body that is not a Paystack event", async () => {
    const junk = fakeWebhook({ hello: "world" });
    expect(await handlePaystackWebhook(junk.rawBody, junk.signature)).toMatchObject({ status: 400 });
    expect(await prisma.paystackEvent.count()).toBe(0);
  });

  it("keeps no customer, card or email data in the stored event", async () => {
    const { reference } = await checkout();
    const { rawBody, signature } = fakeSettle(reference, "success");
    await handlePaystackWebhook(rawBody, signature);
    const event = await prisma.paystackEvent.findFirstOrThrow();
    const json = JSON.stringify(event.payload);
    expect(json).not.toContain("customer");
    expect(json).not.toContain("@example.com");
    expect(event.payload).toEqual({ event: "charge.success", reference, status: "success", amount: 65_000_000, currency: "NGN" });
  });

  it("answers 500 and processes the redelivery when Paystack cannot verify", async () => {
    const { orderId, reference } = await checkout();
    const { rawBody, signature } = fakeSettle(reference, "success");
    fakePaystack.down = true;
    expect(await handlePaystackWebhook(rawBody, signature)).toEqual({ status: 500, outcome: "RETRY" });
    expect(await orderStatus(orderId)).toBe("PENDING_PAYMENT");
    fakePaystack.down = false;
    expect(await handlePaystackWebhook(rawBody, signature)).toEqual({ status: 200, outcome: "PAID" });
    expect(await orderStatus(orderId)).toBe("PAID_HELD");
  });
});
