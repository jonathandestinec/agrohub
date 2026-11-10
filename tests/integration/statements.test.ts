import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack, fakeTransferWebhook } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { ensureBuyerThread } from "@/modules/messaging/service";
import { confirmReceipt, getEarningsStatement, getReceipt, listOwnEarnings, markDelivered, quoteDelivery, startCheckout } from "@/modules/orders/service";
import { handlePaystackWebhook, sendDuePayouts } from "@/modules/payments/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, farmerMember } from "./lot-fixtures";
import { HOUR, paidOrder, paidWorld, type PaidWorld } from "./paid-order";

let w: PaidWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
});

afterAll(cleanDatabase);

// The plan's row 2: 30 bags at ₦65,000 with ₦25,000 delivery, 25 delivered and confirmed.
async function shortfallOrder() {
  w = await paidWorld({ quantity: 40 });
  await ensureBuyerThread(w.lotId, w.buyer.userId);
  const { quoteId } = await quoteDelivery(w.officer, { lotId: w.lotId, buyerUserId: w.buyer.userId, amountKobo: 2_500_000 });
  const at = new Date();
  const { orderId, paidAt } = await paidOrder(w, 30, at, { deliveryQuoteId: quoteId });
  await markDelivered(w.officer, orderId, 25, at);
  await confirmReceipt(w.buyer, orderId, at);
  return { orderId, due: new Date(paidAt.getTime() + 24 * HOUR) };
}

describe("getReceipt", () => {
  it("shows the total, the shortfall refund and the net paid", async () => {
    const { orderId } = await shortfallOrder();
    const receipt = await getReceipt(w.buyer, orderId);
    expect(receipt).toMatchObject({
      cooperativeName: "Zaria Growers",
      crop: "Maize",
      unit: "Bag",
      quantity: 30,
      deliveredQuantity: 25,
      unitKobo: 6_500_000,
      goodsKobo: 195_000_000,
      deliveryKobo: 2_500_000,
      totalKobo: 197_500_000,
      netPaidKobo: 165_000_000,
    });
    expect(receipt.refunds).toEqual([{ amountKobo: 32_500_000, reason: "SHORTFALL", processed: false }]);
  });

  it("another buyer's receipt, or an unpaid order's, is ORDER_NOT_FOUND", async () => {
    const { orderId } = await shortfallOrder();
    const other = await buyerMember("u-other");
    await expect(getReceipt(other, orderId)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    const unpaid = await startCheckout(w.buyer, { source: "LOT", lotId: w.lotId, quantity: 1 });
    await expect(getReceipt(w.buyer, unpaid.orderId)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });
});

describe("earnings statements", () => {
  it("shows the farmer's take-home and the payout, PAID after the transfer webhook", async () => {
    const { orderId, due } = await shortfallOrder();
    let statement = await getEarningsStatement(w.farmer, orderId);
    expect(statement).toMatchObject({
      crop: "Maize",
      contributedQuantity: 40,
      deliveredQuantity: 25,
      unitKobo: 6_500_000,
      cutBps: 500,
      feeBps: 300,
      grossShareKobo: 162_500_000,
      cutKobo: 8_125_000,
      feeKobo: 4_875_000,
      takeHomeKobo: 149_500_000,
    });
    expect(statement.payouts).toEqual([{ part: 1, amountKobo: 149_500_000, status: "WAITING", paidAt: null }]);
    fakePaystack.transferMode = "pending";
    await sendDuePayouts({ now: due });
    expect((await getEarningsStatement(w.farmer, orderId)).payouts[0].status).toBe("SENDING");
    const payout = await prisma.payout.findFirstOrThrow({ where: { orderId, recipientType: "FARMER" } });
    const hook = fakeTransferWebhook(`${payout.reference}-1`, "success");
    await handlePaystackWebhook(hook.rawBody, hook.signature);
    statement = await getEarningsStatement(w.farmer, orderId);
    expect(statement.payouts[0]).toMatchObject({ status: "PAID" });
    expect(statement.payouts[0].paidAt).not.toBeNull();
    expect(await listOwnEarnings(w.farmer)).toEqual([
      expect.objectContaining({ orderId, takeHomeKobo: 149_500_000, status: "PAID" }),
    ]);
    const json = JSON.stringify(statement);
    expect(json).not.toContain(w.buyer.userId);
    expect(json).not.toContain("Buyer");
    expect(json).not.toContain("@example.com");
  });

  it("with two contributors, a farmer sees only their own share", async () => {
    w = await paidWorld({ quantity: 7, askKobo: 33_333, cutBps: 250 });
    const second = await farmerMember("u-farmer-2", w.cooperativeId);
    await prisma.lotContribution.updateMany({ where: { lotId: w.lotId }, data: { quantity: 3 } });
    await prisma.lotContribution.create({ data: { lotId: w.lotId, farmerUserId: second.userId, quantity: 4 } });
    const { orderId } = await paidOrder(w, 7);
    await markDelivered(w.officer, orderId, 7);
    await confirmReceipt(w.buyer, orderId);
    const mine = await getEarningsStatement(w.farmer, orderId);
    expect(mine).toMatchObject({ contributedQuantity: 3, takeHomeKobo: 94_500 });
    expect(mine.grossShareKobo - mine.cutKobo - mine.feeKobo).toBe(94_500);
    const json = JSON.stringify(mine);
    expect(json).not.toContain(second.userId);
    expect(json).not.toContain("125999");
    expect((await getEarningsStatement(second, orderId)).takeHomeKobo).toBe(125_999);
  });

  it("a farmer not on the lot gets ORDER_NOT_FOUND", async () => {
    const { orderId } = await shortfallOrder();
    const stranger = await farmerMember("u-stranger", w.cooperativeId);
    await expect(getEarningsStatement(stranger, orderId)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    await expect(getEarningsStatement(w.buyer, orderId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await listOwnEarnings(stranger)).toEqual([]);
  });
});
