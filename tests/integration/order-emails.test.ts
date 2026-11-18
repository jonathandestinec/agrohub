import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { fakeOutbox } from "@/lib/email";
import { fakePaystack, fakeSettle, fakeWebhook } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import {
  cancelOrder,
  completeOrder,
  markDelivered,
  reportProblem,
  resolveDispute,
  startCheckout,
} from "@/modules/orders/service";
import {
  confirmPayment,
  handlePaystackWebhook,
  reconcile,
  sendDuePayouts,
  settleRefund,
  settleTransferEvent,
} from "@/modules/payments/service";
import { cleanDatabase } from "./helpers";
import { HOUR, paidOrder, paidWorld, type PaidWorld } from "./paid-order";

let w: PaidWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  fakeOutbox.clear();
  w = await paidWorld();
  await prisma.membership.create({ data: { userId: w.admin.userId, role: "ADMIN", status: "ACTIVE" } });
  fakeOutbox.clear();
});

afterAll(cleanDatabase);

const mailTo = (userId: string) => fakeOutbox.sent.filter((m) => m.to === `${userId}@example.com`);
const subjectsTo = (userId: string) => mailTo(userId).map((m) => m.subject);

describe("payment emails", () => {
  it("the buyer, officers and farmers each get one email when the payment is confirmed", async () => {
    const { orderId } = await paidOrder(w, 10);
    expect(subjectsTo(w.buyer.userId)).toEqual(["Your payment is held until delivery is confirmed"]);
    expect(mailTo(w.buyer.userId)[0].html).toContain(`/buyer/orders/${orderId}`);
    expect(subjectsTo(w.officer.userId)).toEqual(["An order was paid: start preparing it"]);
    expect(subjectsTo(w.farmer.userId)).toEqual(["An order for your produce was paid"]);
    // No private field in any of them.
    for (const m of fakeOutbox.sent) expect(m.html.toLowerCase()).not.toMatch(/floor|escrow|phone/);
  });

  it("a replayed confirmation and a reconciliation run after the webhook send nothing more", async () => {
    const { reference } = await paidOrder(w, 10);
    const before = fakeOutbox.sent.length;
    expect(await confirmPayment(reference)).toBe("ALREADY_CONFIRMED");
    await reconcile(new Date());
    expect(fakeOutbox.sent.length).toBe(before);
  });

  it("when the webhook never arrived, the reconciliation that marks it paid emails each person once", async () => {
    const { orderId } = await startCheckout(w.buyer, { source: "LOT", lotId: w.lotId, quantity: 10 }, new Date());
    const { reference } = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    const hook = fakeSettle(reference, "success");
    expect(fakeOutbox.sent).toHaveLength(0);
    await reconcile(new Date());
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PAID_HELD");
    expect(subjectsTo(w.buyer.userId)).toHaveLength(1);
    expect(subjectsTo(w.officer.userId)).toHaveLength(1);
    expect(subjectsTo(w.farmer.userId)).toHaveLength(1);
    // The webhook turning up late, and a second reconciliation, add nothing.
    await handlePaystackWebhook(hook.rawBody, hook.signature);
    await reconcile(new Date());
    expect(fakeOutbox.sent).toHaveLength(3);
  });

  it("a mail failure leaves the order paid and logs no address or html", async () => {
    const email = await import("@/lib/email");
    const spy = vi
      .spyOn(email, "sendEmail")
      .mockRejectedValue(new Error("Resend failed to send email (rate_limit_exceeded)"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { orderId } = await paidOrder(w, 10);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PAID_HELD");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/@example\.com|<p>/);
    spy.mockRestore();
    log.mockRestore();
  });
});

async function releasedOrder() {
  const at = new Date();
  const { orderId, paidAt } = await paidOrder(w, 30, at);
  await markDelivered(w.officer, orderId, 30, at);
  await completeOrder(orderId, "BUYER", at);
  fakeOutbox.clear();
  return { orderId, due: new Date(paidAt.getTime() + 24 * HOUR) };
}

describe("payout and refund emails (on the confirmed success, not at start)", () => {
  it("the farmer and the cooperative officers are emailed once, and not on a replay", async () => {
    const { orderId, due } = await releasedOrder();
    await sendDuePayouts({ now: due });
    expect(subjectsTo(w.farmer.userId)).toEqual(["Your payout was sent"]);
    expect(mailTo(w.farmer.userId)[0].html).toContain(`/farmer/earnings/${orderId}`);
    expect(subjectsTo(w.officer.userId)).toEqual(["Your payout was sent"]);
    const farmerPayout = await prisma.payout.findFirstOrThrow({ where: { orderId, recipientType: "FARMER" } });
    const before = fakeOutbox.sent.length;
    await settleTransferEvent(`${farmerPayout.reference}-1`);
    await settleTransferEvent(`${farmerPayout.reference}-1`);
    expect(fakeOutbox.sent.length).toBe(before);
  });

  it("a transfer that is only pending, or failed, emails no farmer", async () => {
    const { due } = await releasedOrder();
    fakePaystack.transferMode = "pending";
    await sendDuePayouts({ now: due });
    expect(subjectsTo(w.farmer.userId)).toEqual([]);
    fakePaystack.transferMode = "fail";
    await sendDuePayouts({ now: new Date(due.getTime() + 2 * 24 * HOUR) });
    expect(subjectsTo(w.farmer.userId)).toEqual([]);
  });

  async function pendingRefund() {
    const { orderId, reference } = await paidOrder(w, 10);
    await cancelOrder(w.buyer, orderId, "Plans changed");
    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId } });
    fakeOutbox.clear();
    return {
      orderId,
      reference,
      refund,
      event: {
        refundId: refund.paystackRefundId as string,
        transactionReference: reference,
        amountKobo: Number(refund.amountKobo),
      },
    };
  }

  it("the buyer is emailed once when the refund is processed", async () => {
    const { event } = await pendingRefund();
    expect(await settleRefund(event, "PROCESSED")).toBe("SETTLED");
    expect(await settleRefund(event, "PROCESSED")).toBe("ALREADY_SETTLED");
    expect(subjectsTo(w.buyer.userId)).toEqual(["Your refund was sent"]);
  });

  it("a failed refund does not email the buyer", async () => {
    const { event } = await pendingRefund();
    await settleRefund(event, "FAILED");
    expect(subjectsTo(w.buyer.userId)).toEqual([]);
  });

  it("a refund webhook emails the buyer", async () => {
    const { reference, refund } = await pendingRefund();
    const hook = fakeWebhook({
      event: "refund.processed",
      data: {
        id: refund.paystackRefundId,
        status: "processed",
        amount: Number(refund.amountKobo),
        transaction_reference: reference,
      },
    });
    await handlePaystackWebhook(hook.rawBody, hook.signature);
    expect(subjectsTo(w.buyer.userId)).toEqual(["Your refund was sent"]);
  });
});

describe("dispute emails", () => {
  it("a reported problem emails officers and admins, and the ruling emails buyer and officers", async () => {
    const { orderId } = await paidOrder(w, 30);
    await markDelivered(w.officer, orderId, 30);
    fakeOutbox.clear();
    await reportProblem(w.buyer, orderId, "Ten bags were wet", new Date());
    expect(subjectsTo(w.officer.userId)).toEqual(["A problem was reported on an order"]);
    expect(subjectsTo(w.admin.userId)).toEqual(["A problem was reported on an order"]);
    expect(mailTo(w.admin.userId)[0].html).toContain(`/admin/orders/${orderId}`);
    expect(subjectsTo(w.buyer.userId)).toEqual([]);

    fakeOutbox.clear();
    const dispute = await prisma.dispute.findFirstOrThrow({ where: { orderId, status: "OPEN" } });
    await resolveDispute(w.admin, dispute.id, { outcome: "RELEASE", note: "Checked the thread and the photos." }, new Date());
    expect(subjectsTo(w.buyer.userId)).toEqual(["A reported problem was resolved"]);
    expect(subjectsTo(w.officer.userId)).toEqual(["A reported problem was resolved"]);
    expect(subjectsTo(w.admin.userId)).toEqual([]);
  });
});
