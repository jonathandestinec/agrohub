import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack, fakeSettle } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { confirmReceipt, getCooperativeOrder, markDelivered, startCheckout } from "@/modules/orders/service";
import { confirmPayment } from "@/modules/payments/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, farmerMember } from "./lot-fixtures";
import { paidOrder, paidWorld, type PaidWorld } from "./paid-order";

// Part A review minors fixed in Part B.
let w: PaidWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  w = await paidWorld({ quantity: 10 });
});

afterAll(cleanDatabase);

describe("Part A minors", () => {
  it("the cooperative never sees an order refunded as a late payment it never sold", async () => {
    const t0 = new Date(Date.now() - 20 * 60_000);
    const late = await startCheckout(w.buyer, { source: "LOT", lotId: w.lotId, quantity: 10 }, t0);
    const other = await buyerMember("u-other");
    await paidOrder(w, 10, new Date(t0.getTime() + 16 * 60_000), { buyer: other });
    const { reference } = await prisma.payment.findFirstOrThrow({ where: { orderId: late.orderId } });
    fakeSettle(reference, "success");
    expect(await confirmPayment(reference)).toBe("REFUNDING");
    await expect(getCooperativeOrder(w.officer, late.orderId)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });

  it("a completed order's farmer shares are the payouts made at completion, whatever the lot says later", async () => {
    const { orderId } = await paidOrder(w, 10);
    await markDelivered(w.officer, orderId, 10);
    await confirmReceipt(w.buyer, orderId);
    const before = await getCooperativeOrder(w.officer, orderId);
    const late = await farmerMember("u-late", w.cooperativeId);
    await prisma.lotContribution.create({ data: { lotId: w.lotId, farmerUserId: late.userId, quantity: 5 } });
    const after = await getCooperativeOrder(w.officer, orderId);
    expect(after.farmerShares).toEqual(before.farmerShares);
  });
});
