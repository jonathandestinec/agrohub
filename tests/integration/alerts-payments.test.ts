import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeOutbox } from "@/lib/email";
import { prisma } from "@/lib/db";
import { fakePaystack, fakeSettle, fakeWebhook } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { notify } from "@/modules/notifications/service";
import { cancelOrder, completeOrder, markDelivered, startCheckout } from "@/modules/orders/service";
import {
  alertAdmins,
  confirmPayment,
  handlePaystackWebhook,
  reconcile,
  sendDuePayouts,
  settleAttempt,
  settleRefund,
  settleTransferEvent,
} from "@/modules/payments/service";
import { alertKinds, alertsFor } from "./alert-helpers";
import { cleanDatabase } from "./helpers";
import { buyerMember } from "./lot-fixtures";
import { HOUR, paidOrder, paidWorld, type PaidWorld } from "./paid-order";

// Wraps the real notify so one test can make it fail once.
vi.mock("@/modules/notifications/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/notifications/service")>();
  return { ...actual, notify: vi.fn(actual.notify) };
});

let w: PaidWorld;
const QTY = (quantity: number) => ({ crop: "Maize", quantity, unit: "Bag" });
const clearAlerts = () => prisma.notification.deleteMany();

async function setUp(quantity?: number) {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  fakeOutbox.clear();
  w = await paidWorld(quantity === undefined ? {} : { quantity });
  // lotWorld gives the admin no membership row, and alerts go to membership holders.
  await prisma.membership.create({ data: { userId: w.admin.userId, role: "ADMIN", status: "ACTIVE" } });
  await clearAlerts();
}

beforeEach(() => setUp());
afterAll(cleanDatabase);

// Paid now, delivered and confirmed at once: the payouts are queued, sendable 24 h on.
async function releasedOrder() {
  const at = new Date();
  const { orderId, paidAt } = await paidOrder(w, 30, at);
  await markDelivered(w.officer, orderId, 30, at);
  await completeOrder(orderId, "BUYER", at);
  await clearAlerts();
  return { orderId, due: new Date(paidAt.getTime() + 24 * HOUR) };
}
const payoutOf = (orderId: string, recipientType: "FARMER" | "COOPERATIVE") =>
  prisma.payout.findFirstOrThrow({ where: { orderId, recipientType } });

describe("payment alerts", () => {
  it("tells_buyer_officers_and_farmers_a_payment_arrived", async () => {
    const { orderId } = await paidOrder(w, 10);
    expect(await alertKinds(w.buyer.userId)).toEqual(["PAYMENT_CONFIRMED"]);
    expect(await alertKinds(w.officer.userId)).toEqual(["ORDER_PAID"]);
    expect(await alertKinds(w.farmer.userId)).toEqual(["LOT_ORDER_PAID"]);
    expect(await alertsFor(w.buyer.userId)).toMatchObject([
      { role: "BUYER", subjectType: "ORDER", subjectId: orderId, data: QTY(10) },
    ]);
    expect(await alertsFor(w.farmer.userId)).toMatchObject([{ role: "FARMER", cooperativeId: w.cooperativeId }]);
  });

  it("a_second_confirmation_writes_nothing_more", async () => {
    const { reference } = await paidOrder(w, 10);
    const before = await prisma.notification.count();
    expect(await confirmPayment(reference)).toBe("ALREADY_CONFIRMED");
    await reconcile(new Date());
    expect(await prisma.notification.count()).toBe(before);
  });

  it("a_payment_that_is_refunded_tells_no_one_to_prepare", async () => {
    await setUp(10);
    const second = await buyerMember("u-b");
    const t0 = new Date(Date.now() - 20 * 60_000);
    const checkout = async (who: typeof w.buyer, when: Date) => {
      const { orderId } = await startCheckout(who, { source: "LOT", lotId: w.lotId, quantity: 10 }, when);
      const { reference } = await prisma.payment.findFirstOrThrow({ where: { orderId } });
      return { orderId, reference };
    };
    const first = await checkout(w.buyer, t0);
    const prompt = await checkout(second, new Date(t0.getTime() + 16 * 60_000));
    const late = fakeSettle(first.reference, "success");
    const quick = fakeSettle(prompt.reference, "success");
    expect(await handlePaystackWebhook(quick.rawBody, quick.signature)).toMatchObject({ outcome: "PAID" });
    expect(await handlePaystackWebhook(late.rawBody, late.signature)).toMatchObject({ outcome: "REFUNDING" });
    // One order was paid; the late one was refunded and tells nobody to prepare.
    expect(await alertKinds(w.officer.userId)).toEqual(["ORDER_PAID"]);
    expect(await alertKinds(w.farmer.userId)).toEqual(["LOT_ORDER_PAID"]);
    expect(await alertKinds(second.userId)).toEqual(["PAYMENT_CONFIRMED"]);
    expect(await alertKinds(w.buyer.userId)).not.toContain("PAYMENT_CONFIRMED");
  });
});

describe("payout alerts", () => {
  it("tells_the_farmer_and_the_cooperative_their_payout_was_sent", async () => {
    const { orderId, due } = await releasedOrder();
    await sendDuePayouts({ now: due });
    const farmerPayout = await payoutOf(orderId, "FARMER");
    expect(await alertKinds(w.farmer.userId)).toEqual(["PAYOUT_SENT"]);
    expect(await alertsFor(w.farmer.userId)).toMatchObject([
      {
        role: "FARMER",
        cooperativeId: w.cooperativeId,
        subjectType: "ORDER",
        subjectId: orderId,
        data: { crop: "Maize", amountKobo: farmerPayout.amountKobo.toString() },
      },
    ]);
    const coopPayout = await payoutOf(orderId, "COOPERATIVE");
    expect(await alertsFor(w.officer.userId)).toMatchObject([
      { kind: "PAYOUT_SENT", role: "OFFICER", data: { amountKobo: coopPayout.amountKobo.toString() } },
    ]);
  });

  it("a_replayed_transfer_event_writes_no_second_alert", async () => {
    const { orderId, due } = await releasedOrder();
    await sendDuePayouts({ now: due });
    const reference = `${(await payoutOf(orderId, "FARMER")).reference}-1`;
    const before = await prisma.notification.count();
    await settleTransferEvent(reference);
    await settleTransferEvent(reference);
    expect(await prisma.notification.count()).toBe(before);
    expect(await alertKinds(w.farmer.userId)).toEqual(["PAYOUT_SENT"]);
  });

  it("tells_the_farmer_on_a_late_success_once", async () => {
    const { orderId, due } = await releasedOrder();
    fakePaystack.transferMode = "fail";
    await sendDuePayouts({ now: due });
    fakePaystack.transferMode = "success";
    await clearAlerts();
    const reference = `${(await payoutOf(orderId, "FARMER")).reference}-1`;
    expect(await settleAttempt(reference, "PAID", due)).toBe("SETTLED");
    expect(await settleAttempt(reference, "PAID", due)).toBe("ALREADY_SETTLED");
    expect(await alertKinds(w.farmer.userId)).toEqual(["PAYOUT_SENT"]);
  });

  it("tells_admins_about_a_failed_payout", async () => {
    const { due } = await releasedOrder();
    fakePaystack.transferMode = "fail";
    await sendDuePayouts({ now: due });
    const rows = await alertsFor(w.admin.userId);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toMatchObject({
        kind: "PAYOUT_PROBLEM",
        role: "ADMIN",
        cooperativeId: null,
        subjectType: "ORDER",
        data: { problem: "FAILED" },
      });
    }
    // A failed transfer is not "sent": nobody else hears of it.
    expect(await alertKinds(w.farmer.userId)).toEqual([]);
  });

  it("tells_admins_about_a_reconciliation_issue", async () => {
    const { due } = await releasedOrder();
    fakePaystack.transferMode = "pending";
    await sendDuePayouts({ now: due });
    await reconcile(new Date(due.getTime() + 4 * 24 * HOUR));
    const kinds = await alertKinds(w.admin.userId);
    expect(kinds).toContain("RECONCILIATION_ISSUE");
    expect(await alertsFor(w.admin.userId)).toContainEqual(
      expect.objectContaining({ kind: "RECONCILIATION_ISSUE", data: { problem: "STALE" } }),
    );
  });

  it("an_alert_write_failure_in_alert_admins_does_not_throw", async () => {
    vi.mocked(notify).mockRejectedValueOnce(new Error("database is down"));
    await expect(
      alertAdmins({ kind: "FAILED", orderId: "order-1", amountKobo: 1000, recipientType: "FARMER" }),
    ).resolves.toBeUndefined();
    expect(fakeOutbox.sent.length).toBeGreaterThan(0);
  });
});

describe("refund alerts", () => {
  async function pendingRefund() {
    const { orderId, reference } = await paidOrder(w, 10);
    await cancelOrder(w.buyer, orderId, "Plans changed");
    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId } });
    await clearAlerts();
    const event = {
      refundId: refund.paystackRefundId as string,
      transactionReference: reference,
      amountKobo: Number(refund.amountKobo),
    };
    return { orderId, refund, event };
  }

  it("tells_the_buyer_their_refund_was_sent_once", async () => {
    const { orderId, event, refund } = await pendingRefund();
    expect(await settleRefund(event, "PROCESSED")).toBe("SETTLED");
    expect(await settleRefund(event, "PROCESSED")).toBe("ALREADY_SETTLED");
    expect(await alertsFor(w.buyer.userId)).toMatchObject([
      {
        kind: "REFUND_SENT",
        role: "BUYER",
        subjectType: "ORDER",
        subjectId: orderId,
        data: { crop: "Maize", amountKobo: refund.amountKobo.toString() },
      },
    ]);
  });

  it("a_failed_refund_tells_admins_not_the_buyer", async () => {
    const { event } = await pendingRefund();
    expect(await settleRefund(event, "FAILED")).toBe("SETTLED");
    expect(await alertKinds(w.buyer.userId)).toEqual([]);
    expect(await alertsFor(w.admin.userId)).toMatchObject([
      { kind: "PAYOUT_PROBLEM", data: { problem: "REFUND_FAILED" } },
    ]);
  });
});

// The webhook is the usual way a refund event arrives; check one reaches the alert too.
describe("refund webhook", () => {
  it("a_refund_webhook_tells_the_buyer", async () => {
    const { orderId, reference } = await paidOrder(w, 10);
    await cancelOrder(w.buyer, orderId, "Plans changed");
    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId } });
    await clearAlerts();
    const hook = fakeWebhook({
      event: "refund.processed",
      data: {
        id: refund.paystackRefundId,
        status: "processed",
        amount: Number(refund.amountKobo),
        transaction_reference: reference,
      },
    });
    expect(await handlePaystackWebhook(hook.rawBody, hook.signature)).toMatchObject({ status: 200 });
    expect(await alertKinds(w.buyer.userId)).toEqual(["REFUND_SENT"]);
  });
});
