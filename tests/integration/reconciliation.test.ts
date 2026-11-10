import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/[job]/route";
import { fakeOutbox } from "@/lib/email";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { getJob } from "@/lib/jobs/registry";
import { fakePaystack, fakeSettle } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { cancelOrder, completeOrder, listOrderQueue, markDelivered, startCheckout } from "@/modules/orders/service";
import { reconcile, resolveReconciliationIssue, sendDuePayouts } from "@/modules/payments/service";
import { cleanDatabase } from "./helpers";
import { HOUR, paidOrder, paidWorld, type PaidWorld } from "./paid-order";

let w: PaidWorld;
const DAY = 24 * HOUR;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  fakeOutbox.clear();
  w = await paidWorld();
  await prisma.membership.create({ data: { userId: w.admin.userId, role: "ADMIN", status: "ACTIVE" } });
});

afterAll(cleanDatabase);

const issues = () => prisma.reconciliationIssue.findMany({ orderBy: { createdAt: "asc" } });

describe("reconcile", () => {
  it("confirms a payment whose webhook never came, and records nothing", async () => {
    const { orderId } = await startCheckout(w.buyer, { source: "LOT", lotId: w.lotId, quantity: 10 });
    const { reference } = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    fakeSettle(reference, "success");
    expect(await reconcile(new Date())).toEqual({ issues: 0 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PAID_HELD");
    expect(await issues()).toEqual([]);
  });

  it("records a Paystack payment with an unknown reference once, and emails admins once", async () => {
    fakePaystack.transactions.set("pay_unknown", {
      amountKobo: 5_000_000,
      email: "someone@example.com",
      status: "success",
      transactionId: "9001",
      feesKobo: 0,
      paidAt: new Date().toISOString(),
    });
    expect(await reconcile(new Date())).toEqual({ issues: 1 });
    const recorded = await issues();
    expect(recorded.map((i) => [i.kind, i.reference])).toEqual([["UNCONFIRMED_PAYMENT", "pay_unknown"]]);
    expect(JSON.stringify(recorded[0].detail)).not.toContain("someone@example.com");
    expect(fakeOutbox.sent.filter((m) => m.subject.includes("reconciliation"))).toHaveLength(1);
    expect(await reconcile(new Date())).toEqual({ issues: 0 });
    expect(await issues()).toHaveLength(1);
    expect(fakeOutbox.sent.filter((m) => m.subject.includes("reconciliation"))).toHaveLength(1);

    const queue = await listOrderQueue(w.admin, new Date());
    expect(queue.map((q) => [q.kind, q.detail])).toEqual([["RECONCILIATION", "UNCONFIRMED_PAYMENT"]]);
    await resolveReconciliationIssue(w.admin, recorded[0].id, "Refunded by hand on the dashboard.");
    expect(await listOrderQueue(w.admin, new Date())).toEqual([]);
    await expect(resolveReconciliationIssue(w.officer, recorded[0].id, "Refunded by hand.")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("stale_pending_transfer_is_flagged", async () => {
    const at = new Date(Date.now() - 6 * DAY);
    const { orderId, paidAt } = await paidOrder(w, 30, at);
    await markDelivered(w.officer, orderId, 30, at);
    await completeOrder(orderId, "BUYER", at);
    fakePaystack.transferMode = "pending";
    const sentAt = new Date(paidAt.getTime() + DAY);
    await sendDuePayouts({ now: sentAt });
    expect(await reconcile(new Date(sentAt.getTime() + 2 * DAY))).toEqual({ issues: 0 });
    expect(await reconcile(new Date(sentAt.getTime() + 4 * DAY))).toEqual({ issues: 2 });
    expect((await issues()).map((i) => i.kind)).toEqual(["STALE_TRANSFER", "STALE_TRANSFER"]);
    expect(fakeOutbox.sent.filter((m) => m.subject.includes("awaiting Paystack"))).toHaveLength(2);
  });

  it("settles a SENT transfer Paystack now reports as paid", async () => {
    const at = new Date(Date.now() - 3 * DAY);
    const { orderId, paidAt } = await paidOrder(w, 30, at);
    await markDelivered(w.officer, orderId, 30, at);
    await completeOrder(orderId, "BUYER", at);
    fakePaystack.transferMode = "pending";
    const sentAt = new Date(paidAt.getTime() + DAY);
    await sendDuePayouts({ now: sentAt });
    for (const transfer of fakePaystack.transfers.values()) transfer.status = "success";
    await reconcile(new Date(sentAt.getTime() + 2 * HOUR));
    const payouts = await prisma.payout.findMany({ where: { orderId } });
    expect(payouts.map((p) => p.status)).toEqual(["PAID", "PAID"]);
  });

  it("sends a refund Paystack never received, once", async () => {
    const { orderId } = await paidOrder(w, 10);
    fakePaystack.failNextRefund = true;
    await cancelOrder(w.buyer, orderId, "", new Date());
    expect(fakePaystack.refunds).toHaveLength(0);
    await reconcile(new Date());
    expect(fakePaystack.refunds).toHaveLength(1);
    await reconcile(new Date());
    expect(fakePaystack.refunds).toHaveLength(1);
  });

  it("is registered as the reconciliation cron job", async () => {
    await import("@/lib/jobs");
    expect(getJob("reconciliation")).toBeTypeOf("function");
    const response = await GET(
      new Request("http://localhost:3000/api/cron/reconciliation", { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }),
      { params: Promise.resolve({ job: "reconciliation" }) },
    );
    expect(response.status).toBe(200);
  });
});
