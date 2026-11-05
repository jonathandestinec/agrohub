import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack, fakeWebhook } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { availableQuantity } from "@/modules/catalog/service";
import { ensureBuyerThread } from "@/modules/messaging/service";
import {
  answerCancelRequest,
  cancelOrder,
  cooperativeCancellations,
  markDelivered,
  quoteDelivery,
  startPreparing,
} from "@/modules/orders/service";
import { handlePaystackWebhook, ledgerBalance } from "@/modules/payments/service";
import { cleanDatabase } from "./helpers";
import { paidOrder, paidWorld, type PaidWorld } from "./paid-order";

let w: PaidWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  w = await paidWorld();
});

afterAll(cleanDatabase);

const order = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, include: { refunds: true } });

async function threadLines(orderId: string): Promise<string[]> {
  const o = await order(orderId);
  const thread = await prisma.thread.findFirstOrThrow({
    where: { lotId: o.lotId, kind: "BUYER_COOPERATIVE", counterpartUserId: o.buyerUserId },
    include: { messages: { where: { side: "ADMIN" }, orderBy: { createdAt: "asc" } } },
  });
  return thread.messages.map((m) => m.body);
}

// 10 bags with a ₦25,000 delivery quote: ₦675,000 in all.
async function deliveredOrder(quantity = 10) {
  await ensureBuyerThread(w.lotId, w.buyer.userId);
  const { quoteId } = await quoteDelivery(w.officer, { lotId: w.lotId, buyerUserId: w.buyer.userId, amountKobo: 2_500_000 });
  return paidOrder(w, quantity, new Date(), { deliveryQuoteId: quoteId });
}

describe("cancelOrder", () => {
  it("the buyer cancels a PAID_HELD order: REFUNDED in full, delivery included, refunded once, stock free again", async () => {
    const { orderId } = await deliveredOrder();
    expect(await availableQuantity(w.lotId, new Date())).toBe(20);
    await cancelOrder(w.buyer, orderId, "", new Date());
    const after = await order(orderId);
    expect(after).toMatchObject({ status: "REFUNDED", cancelReason: "BUYER_CANCEL", cancelledByCooperative: false });
    expect(after.refunds.map((r) => [r.purpose, r.reason, Number(r.amountKobo)])).toEqual([["cancel", "BUYER_CANCEL", 67_500_000]]);
    expect(fakePaystack.refunds.map((r) => r.amountKobo)).toEqual([67_500_000]);
    expect(await availableQuantity(w.lotId, new Date())).toBe(30);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "order.cancel", entityId: orderId } });
    expect(audit.meta).toEqual({ orderId, by: "BUYER", refundKobo: 67_500_000 });
  });

  it("a SOLD_OUT lot returns to LIVE when an order is cancelled", async () => {
    const { orderId } = await paidOrder(w, 30);
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: w.lotId } })).status).toBe("SOLD_OUT");
    await cancelOrder(w.buyer, orderId, "", new Date());
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: w.lotId } })).status).toBe("LIVE");
  });

  it("the buyer asks to cancel a PREPARING order; the officer agrees: REFUNDED", async () => {
    const { orderId } = await paidOrder(w, 10);
    await startPreparing(w.officer, orderId);
    await cancelOrder(w.buyer, orderId, "Plans changed", new Date());
    const asked = await order(orderId);
    expect(asked.status).toBe("PREPARING");
    expect(asked.cancelRequestedAt).not.toBeNull();
    expect(asked.refunds).toEqual([]);
    expect(await threadLines(orderId)).toContain("The buyer asked to cancel: Plans changed");
    await answerCancelRequest(w.officer, orderId, true, new Date());
    const done = await order(orderId);
    expect(done).toMatchObject({ status: "REFUNDED", cancelReason: "BUYER_CANCEL" });
    expect(done.refunds.map((r) => [r.reason, Number(r.amountKobo)])).toEqual([["BUYER_CANCEL", 65_000_000]]);
  });

  it("the officer declines a cancel request: the request is cleared and the order goes on", async () => {
    const { orderId } = await paidOrder(w, 10);
    await startPreparing(w.officer, orderId);
    await cancelOrder(w.buyer, orderId, "Plans changed", new Date());
    await answerCancelRequest(w.officer, orderId, false, new Date());
    const after = await order(orderId);
    expect(after).toMatchObject({ status: "PREPARING", cancelRequestedAt: null });
    expect(await threadLines(orderId)).toContain("The cooperative declined the request to cancel. The order goes ahead.");
    await expect(answerCancelRequest(w.officer, orderId, true, new Date())).rejects.toMatchObject({ code: "NO_CANCEL_REQUEST" });
  });

  it("the cooperative cancels with a reason: REFUNDED, counted against the cooperative", async () => {
    const { orderId } = await paidOrder(w, 10);
    await cancelOrder(w.officer, orderId, "The maize got wet in storage", new Date());
    const after = await order(orderId);
    expect(after).toMatchObject({ status: "REFUNDED", cancelReason: "COOPERATIVE_CANCEL", cancelledByCooperative: true });
    expect(after.refunds.map((r) => r.reason)).toEqual(["COOPERATIVE_CANCEL"]);
    expect(await cooperativeCancellations(w.admin, w.cooperativeId)).toBe(1);
    await expect(cooperativeCancellations(w.officer, w.cooperativeId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the cooperative must give a reason: REASON_REQUIRED; contact details are refused", async () => {
    const { orderId } = await paidOrder(w, 10);
    await expect(cancelOrder(w.officer, orderId, "", new Date())).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(cancelOrder(w.officer, orderId, "ok", new Date())).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(cancelOrder(w.officer, orderId, "call me on 08031234567", new Date())).rejects.toMatchObject({ code: "MESSAGE_HAS_CONTACT" });
    expect((await order(orderId)).status).toBe("PAID_HELD");
  });

  it("refuses to cancel a DELIVERED_MARKED order: ORDER_STATE", async () => {
    const { orderId } = await paidOrder(w, 10);
    await markDelivered(w.officer, orderId, 10);
    await expect(cancelOrder(w.buyer, orderId, "", new Date())).rejects.toMatchObject({ code: "ORDER_STATE" });
    await expect(cancelOrder(w.officer, orderId, "Cannot deliver after all", new Date())).rejects.toMatchObject({ code: "ORDER_STATE" });
  });

  it("two cancellations at once refund once", async () => {
    const { orderId } = await paidOrder(w, 10);
    const results = await Promise.allSettled([
      cancelOrder(w.buyer, orderId, "", new Date()),
      cancelOrder(w.officer, orderId, "Out of stock today", new Date()),
      cancelOrder(w.buyer, orderId, "", new Date()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await order(orderId)).refunds).toHaveLength(1);
    expect(fakePaystack.refunds).toHaveLength(1);
  });

  it("the ledger sums to zero once the refund is processed", async () => {
    const { orderId } = await deliveredOrder();
    await cancelOrder(w.buyer, orderId, "", new Date());
    const refund = (await order(orderId)).refunds[0];
    const hook = fakeWebhook({ event: "refund.processed", data: { id: refund.paystackRefundId, status: "processed", amount: 67_500_000 } });
    await handlePaystackWebhook(hook.rawBody, hook.signature);
    expect(await ledgerBalance(orderId, "HELD")).toBe(0);
    expect(await ledgerBalance(orderId, "REFUND_PAYABLE")).toBe(0);
    expect(await ledgerBalance(orderId)).toBe(0);
  });

  it("another buyer cannot cancel: ORDER_NOT_FOUND", async () => {
    const { orderId } = await paidOrder(w, 10);
    const { buyerMember } = await import("./lot-fixtures");
    const other = await buyerMember("u-other");
    await expect(cancelOrder(other, orderId, "", new Date())).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });
});
