import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fakeOutbox } from "@/lib/email";
import { prisma } from "@/lib/db";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { completeOrder, markDelivered } from "@/modules/orders/service";
import { payoutOutcome, retryPayout, sendDuePayouts } from "@/modules/payments/service";
import { cleanDatabase } from "./helpers";
import { HOUR, paidOrder, paidWorld, type PaidWorld } from "./paid-order";

let w: PaidWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  fakeOutbox.clear();
  w = await paidWorld({ quantity: 60 });
});

afterAll(cleanDatabase);

async function failedFarmerPayout() {
  const at = new Date();
  const { orderId, paidAt } = await paidOrder(w, 30, at);
  await markDelivered(w.officer, orderId, 30, at);
  await completeOrder(orderId, "BUYER", at);
  const due = new Date(paidAt.getTime() + 24 * HOUR);
  fakePaystack.transferMode = "fail";
  await sendDuePayouts({ now: due });
  fakePaystack.transferMode = "success";
  const payout = await prisma.payout.findFirstOrThrow({ where: { orderId, recipientType: "FARMER" } });
  return { payout, due };
}

describe("payoutOutcome", () => {
  it("reports a failed payout with the reason stored on its last attempt", async () => {
    const { payout } = await failedFarmerPayout();
    expect(await payoutOutcome(w.admin, payout.id)).toEqual({ status: "FAILED", failureReason: "FAILED" });
  });

  it("reports paid, with no failure, after a successful retry", async () => {
    const { payout, due } = await failedFarmerPayout();
    await retryPayout(w.admin, payout.id, { useCurrentAccount: false }, due);
    expect(await payoutOutcome(w.admin, payout.id)).toEqual({ status: "PAID", failureReason: null });
  });

  it("is for admins only", async () => {
    const { payout } = await failedFarmerPayout();
    await expect(payoutOutcome(w.officer, payout.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses an unknown payout", async () => {
    await expect(payoutOutcome(w.admin, "nope")).rejects.toMatchObject({ code: "PAYOUT_NOT_FOUND" });
  });
});
