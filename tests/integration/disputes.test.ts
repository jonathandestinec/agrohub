import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { completeOrder } from "@/modules/orders/service";
import { suspendCooperative } from "@/modules/cooperatives/service";
import {
  confirmReceipt,
  getOrderForAdmin,
  listOrderQueue,
  markDelivered,
  reportProblem,
  resolveDispute,
  runOrderTimers,
} from "@/modules/orders/service";
import { ledgerBalance } from "@/modules/payments/service";
import { cleanDatabase } from "./helpers";
import { HOUR, paidOrder, paidWorld, type PaidWorld } from "./paid-order";

let w: PaidWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  w = await paidWorld({ quantity: 60 });
});

afterAll(cleanDatabase);

const order = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, include: { refunds: true, payouts: true } });
const openDispute = (orderId: string) => prisma.dispute.findFirstOrThrow({ where: { orderId, status: "OPEN" } });
const NOTE = "Checked the thread and the photos.";

async function reported(delivered = 30) {
  const { orderId } = await paidOrder(w, 30);
  await markDelivered(w.officer, orderId, delivered);
  await reportProblem(w.buyer, orderId, "Ten bags were wet", new Date());
  return orderId;
}

describe("completeOrder by caller", () => {
  const nothingMoved = async (orderId: string, status: string) => {
    expect((await order(orderId)).status).toBe(status);
    expect(await prisma.payout.count({ where: { orderId } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { orderId, kind: "order.released" } })).toBe(0);
  };

  it.each(["AUTO", "BUYER"] as const)("%s cannot release an order that was disputed after it was read", async (by) => {
    const orderId = await reported();
    expect(await completeOrder(orderId, by, new Date(Date.now() + 4 * 24 * HOUR))).toBe(false);
    await nothingMoved(orderId, "DISPUTED");
  });

  it("ADMIN cannot release an order that is only delivered, not frozen", async () => {
    const { orderId } = await paidOrder(w, 30);
    await markDelivered(w.officer, orderId, 30);
    expect(await completeOrder(orderId, "ADMIN", new Date())).toBe(false);
    await nothingMoved(orderId, "DELIVERED_MARKED");
  });
});

describe("reportProblem", () => {
  it("freezes a delivered order: DISPUTED, not confirmable, not auto-released", async () => {
    const orderId = await reported();
    expect((await order(orderId)).status).toBe("DISPUTED");
    const dispute = await openDispute(orderId);
    expect(dispute).toMatchObject({ kind: "REPORT", reason: "Ten bags were wet", openedByUserId: w.buyer.userId });
    await expect(confirmReceipt(w.buyer, orderId)).rejects.toMatchObject({ code: "ORDER_STATE" });
    expect(await runOrderTimers(new Date(Date.now() + 4 * 24 * HOUR))).toMatchObject({ released: 0 });
    expect((await order(orderId)).status).toBe("DISPUTED");
    const thread = await prisma.message.findMany({ where: { side: "ADMIN", body: { startsWith: "The buyer reported a problem" } } });
    expect(thread).toHaveLength(1);
  });

  it("needs a reason of 5 to 1000 characters without contact details", async () => {
    const { orderId } = await paidOrder(w, 30);
    await expect(reportProblem(w.buyer, orderId, "bad", new Date())).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(reportProblem(w.buyer, orderId, "call me 08031234567", new Date())).rejects.toMatchObject({ code: "MESSAGE_HAS_CONTACT" });
    expect((await order(orderId)).status).toBe("PAID_HELD");
  });

  it("after COMPLETED it records a note-only dispute and moves no money", async () => {
    const { orderId } = await paidOrder(w, 30);
    await markDelivered(w.officer, orderId, 30);
    await confirmReceipt(w.buyer, orderId);
    const before = await ledgerBalance(orderId, "PAYSTACK_BALANCE");
    await reportProblem(w.buyer, orderId, "Two bags had weevils", new Date());
    expect((await order(orderId)).status).toBe("COMPLETED");
    const dispute = await openDispute(orderId);
    expect(dispute.kind).toBe("AFTER_COMPLETION");
    await expect(resolveDispute(w.admin, dispute.id, { outcome: "REFUND_ALL", note: NOTE }, new Date())).rejects.toMatchObject({ code: "OUTCOME_NOT_ALLOWED" });
    await resolveDispute(w.admin, dispute.id, { outcome: "NOTE", note: NOTE }, new Date());
    expect(await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).toMatchObject({ status: "RESOLVED", outcome: "NOTE", decisionNote: NOTE });
    expect(await ledgerBalance(orderId, "PAYSTACK_BALANCE")).toBe(before);
    expect((await order(orderId)).refunds).toEqual([]);
  });
});

describe("resolveDispute", () => {
  it("RELEASE pays out as a confirmation would", async () => {
    const orderId = await reported();
    const disputeId = (await openDispute(orderId)).id;
    await resolveDispute(w.admin, disputeId, { outcome: "RELEASE", note: NOTE }, new Date());
    const after = await order(orderId);
    expect(after.status).toBe("COMPLETED");
    expect(after.payouts.map((p) => Number(p.amountKobo)).sort((a, b) => a - b)).toEqual([9_750_000, 179_400_000]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "dispute.resolve", entityId: disputeId } });
    expect(audit.meta).toMatchObject({ outcome: "RELEASE", unitsRefunded: null });
  });

  it("REFUND_ALL refunds everything and creates no payouts", async () => {
    const orderId = await reported();
    await resolveDispute(w.admin, (await openDispute(orderId)).id, { outcome: "REFUND_ALL", note: NOTE }, new Date());
    const after = await order(orderId);
    expect(after.status).toBe("REFUNDED");
    expect(after.refunds.map((r) => [r.purpose, r.reason, Number(r.amountKobo)])).toEqual([["dispute", "ADMIN_DECISION", 195_000_000]]);
    expect(after.payouts).toEqual([]);
  });

  it("REFUND_UNITS 5 of 30 refunds 32,500,000 and pays on 25", async () => {
    const orderId = await reported();
    await resolveDispute(w.admin, (await openDispute(orderId)).id, { outcome: "REFUND_UNITS", unitsRefunded: 5, note: NOTE }, new Date());
    const after = await order(orderId);
    expect(after.status).toBe("COMPLETED");
    expect(after.refunds.map((r) => Number(r.amountKobo))).toEqual([32_500_000]);
    expect(after.payouts.map((p) => Number(p.amountKobo)).sort((a, b) => a - b)).toEqual([8_125_000, 149_500_000]);
  });

  it("REFUND_UNITS of all 30 is UNITS_RANGE", async () => {
    const orderId = await reported();
    const dispute = await openDispute(orderId);
    await expect(resolveDispute(w.admin, dispute.id, { outcome: "REFUND_UNITS", unitsRefunded: 30, note: NOTE }, new Date())).rejects.toMatchObject({ code: "UNITS_RANGE" });
    await expect(resolveDispute(w.admin, dispute.id, { outcome: "REFUND_UNITS", unitsRefunded: 0, note: NOTE }, new Date())).rejects.toMatchObject({ code: "UNITS_RANGE" });
    expect((await order(orderId)).status).toBe("DISPUTED");
  });

  it("needs a note, decides once, and only admins decide", async () => {
    const orderId = await reported();
    const dispute = await openDispute(orderId);
    await expect(resolveDispute(w.officer, dispute.id, { outcome: "RELEASE", note: NOTE }, new Date())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(resolveDispute(w.admin, dispute.id, { outcome: "RELEASE", note: "" }, new Date())).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await resolveDispute(w.admin, dispute.id, { outcome: "RELEASE", note: NOTE }, new Date());
    await expect(resolveDispute(w.admin, dispute.id, { outcome: "REFUND_ALL", note: NOTE }, new Date())).rejects.toMatchObject({ code: "DISPUTE_RESOLVED" });
  });

  it("the admin view of the order has its thread, ledger totals and payouts, and no account codes", async () => {
    const orderId = await reported();
    await resolveDispute(w.admin, (await openDispute(orderId)).id, { outcome: "RELEASE", note: NOTE }, new Date());
    const view = await getOrderForAdmin(w.admin, orderId);
    expect(view.messages.some((m) => m.body.startsWith("The buyer reported a problem"))).toBe(true);
    expect(view.ledger.HELD).toBe(0);
    expect(view.payouts).toHaveLength(2);
    expect(view.disputes.map((d) => d.outcome)).toEqual(["RELEASE"]);
    expect(JSON.stringify(view)).not.toContain("RCP_");
    await expect(getOrderForAdmin(w.officer, orderId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the admin order queue", () => {
  it("suspended_cooperative_orders_reach_admin_queue", async () => {
    const { orderId } = await paidOrder(w, 10);
    await suspendCooperative(w.admin, w.cooperativeId, "Documents under review");
    expect((await order(orderId)).status).toBe("DISPUTED");
    const queue = await listOrderQueue(w.admin, new Date());
    expect(queue.filter((q) => q.orderId === orderId).map((q) => q.kind)).toEqual(["SUSPENSION"]);
    await expect(markDelivered(w.officer, orderId, 10)).rejects.toMatchObject({ code: "ORDER_STATE" });
  });

  it("lists open disputes oldest first, and not resolved ones", async () => {
    const first = await reported();
    const second = await reported();
    const queue = await listOrderQueue(w.admin, new Date());
    expect(queue.filter((q) => q.kind === "REPORT").map((q) => q.orderId)).toEqual([first, second]);
    await resolveDispute(w.admin, (await openDispute(first)).id, { outcome: "RELEASE", note: NOTE }, new Date());
    expect((await listOrderQueue(w.admin, new Date())).filter((q) => q.kind === "REPORT").map((q) => q.orderId)).toEqual([second]);
    await expect(listOrderQueue(w.officer, new Date())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
