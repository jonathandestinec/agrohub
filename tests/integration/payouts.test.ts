import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { fakeOutbox } from "@/lib/email";
import { prisma } from "@/lib/db";
import { fakePaystack, fakeTransferWebhook } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { completeOrder, markDelivered } from "@/modules/orders/service";
import { handlePaystackWebhook, ledgerBalance, sendDuePayouts } from "@/modules/payments/service";
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
});

afterAll(cleanDatabase);

// Paid now, delivered and confirmed at once: the payouts are queued, sendable 24 h on, and the
// send right after release sends nothing yet.
async function releasedOrder(quantity = 30, delivered = quantity) {
  const at = new Date();
  const { orderId, paidAt } = await paidOrder(w, quantity, at);
  await markDelivered(w.officer, orderId, delivered, at);
  await completeOrder(orderId, "BUYER", at);
  return { orderId, due: new Date(paidAt.getTime() + 24 * HOUR) };
}

const payouts = (orderId: string) =>
  prisma.payout.findMany({ where: { orderId }, include: { attempts: { orderBy: { attempt: "asc" } } }, orderBy: [{ recipientType: "asc" }, { part: "asc" }] });

describe("sendDuePayouts", () => {
  it("sends nothing before sendableAt, then both payouts at paidAt + 24 h", async () => {
    const { orderId, due } = await releasedOrder();
    expect(fakePaystack.transfers.size).toBe(0);
    expect(await sendDuePayouts({ now: new Date(due.getTime() - 60_000) })).toEqual({ sent: 0, deferred: 0 });
    expect(await sendDuePayouts({ now: due })).toEqual({ sent: 2, deferred: 0 });
    const rows = await payouts(orderId);
    expect(rows.map((p) => p.status)).toEqual(["PAID", "PAID"]);
    expect(rows.map((p) => p.attempts.map((a) => [a.attempt, a.transferReference, a.status]))).toEqual([
      [[1, `${rows[0].reference}-1`, "SUCCEEDED"]],
      [[1, `${rows[1].reference}-1`, "SUCCEEDED"]],
    ]);
    expect([...fakePaystack.transfers.entries()].map(([ref, t]) => [ref, t.amountKobo, t.recipientCode]).sort()).toEqual(
      [
        [`${rows[0].reference}-1`, 9_750_000, "RCP_COOP"],
        [`${rows[1].reference}-1`, 179_400_000, `RCP_${w.farmer.userId}`],
      ].sort(),
    );
    const paidAudit = await prisma.auditLog.count({ where: { action: "payout.paid", entityId: { in: rows.map((r) => r.id) } } });
    expect(paidAudit).toBe(2);
  });

  it("sends at release when the funds have already cleared", async () => {
    const past = new Date(Date.now() - 30 * HOUR);
    const { orderId } = await paidOrder(w, 30, past);
    await markDelivered(w.officer, orderId, 30, past);
    await completeOrder(orderId, "BUYER", new Date());
    expect((await payouts(orderId)).map((p) => p.status)).toEqual(["PAID", "PAID"]);
  });

  it("payout_reference_is_unique", async () => {
    const { orderId, due } = await releasedOrder();
    const [first] = await payouts(orderId);
    await expect(
      prisma.payout.create({
        data: {
          orderId,
          recipientType: "COOPERATIVE",
          recipientId: "another",
          part: 1,
          amountKobo: BigInt(1),
          reference: first.reference,
          sendableAt: due,
        },
      }),
    ).rejects.toSatisfy((e) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002");
    const results = await Promise.all([sendDuePayouts({ now: due }), sendDuePayouts({ now: due }), sendDuePayouts({ now: due })]);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(2);
    expect(fakePaystack.transfers.size).toBe(2);
    expect(await prisma.payoutAttempt.count()).toBe(2);
  });

  it("pending_transfer_is_never_retried", async () => {
    const { orderId, due } = await releasedOrder();
    fakePaystack.transferMode = "pending";
    await sendDuePayouts({ now: due });
    expect((await payouts(orderId)).map((p) => p.status)).toEqual(["SENT", "SENT"]);
    expect(await sendDuePayouts({ now: new Date(due.getTime() + 72 * HOUR) })).toEqual({ sent: 0, deferred: 0 });
    expect(fakePaystack.transfers.size).toBe(2);
    const farmer = (await payouts(orderId))[1];
    const hook = fakeTransferWebhook(`${farmer.reference}-1`, "success");
    expect(await handlePaystackWebhook(hook.rawBody, hook.signature)).toMatchObject({ status: 200, outcome: "PAID" });
    const after = (await payouts(orderId))[1];
    expect(after.status).toBe("PAID");
    expect(after.attempts[0].status).toBe("SUCCEEDED");
    expect(await ledgerBalance(orderId, "FARMER_PAYABLE")).toBe(0);
    const groups = () => prisma.ledgerEntry.groupBy({ by: ["groupId"], where: { orderId, kind: "payout.paid" } });
    expect(await groups()).toHaveLength(1);
    expect(await handlePaystackWebhook(hook.rawBody, hook.signature)).toMatchObject({ outcome: "DUPLICATE" });
    // The same news by another delivery key (a reconciliation check, say) changes nothing either.
    const { settleAttempt } = await import("@/modules/payments/service");
    expect(await settleAttempt(`${farmer.reference}-1`, "PAID")).toBe("ALREADY_SETTLED");
    expect(await groups()).toHaveLength(1);
  });

  it("a failed transfer marks the payout FAILED and alerts each active admin, never PAID", async () => {
    await prisma.membership.create({ data: { userId: w.board.userId, role: "ADMIN", status: "ACTIVE" } });
    const { orderId, due } = await releasedOrder();
    fakePaystack.transferMode = "fail";
    await sendDuePayouts({ now: due });
    const rows = await payouts(orderId);
    expect(rows.map((p) => [p.status, p.attempts[0].status])).toEqual([
      ["FAILED", "FAILED"],
      ["FAILED", "FAILED"],
    ]);
    const alerts = fakeOutbox.sent.filter((m) => m.subject.includes("payout failed"));
    expect(alerts.map((m) => m.to).sort()).toEqual([`${w.admin.userId}@example.com`, `${w.admin.userId}@example.com`, `${w.board.userId}@example.com`, `${w.board.userId}@example.com`].sort());
    expect(await prisma.auditLog.count({ where: { action: "payout.failed", entityId: { in: rows.map((r) => r.id) } } })).toBe(2);
    await sendDuePayouts({ now: new Date(due.getTime() + 48 * HOUR) });
    expect((await payouts(orderId)).map((p) => p.status)).toEqual(["FAILED", "FAILED"]);
  });

  it("a transfer that fails later (webhook) marks the payout FAILED; reversed too", async () => {
    const { orderId, due } = await releasedOrder();
    fakePaystack.transferMode = "pending";
    await sendDuePayouts({ now: due });
    const [coop, farmer] = await payouts(orderId);
    const failed = fakeTransferWebhook(`${coop.reference}-1`, "failed");
    expect(await handlePaystackWebhook(failed.rawBody, failed.signature)).toMatchObject({ outcome: "FAILED" });
    const reversed = fakeTransferWebhook(`${farmer.reference}-1`, "reversed");
    expect(await handlePaystackWebhook(reversed.rawBody, reversed.signature)).toMatchObject({ outcome: "FAILED" });
    const rows = await payouts(orderId);
    expect(rows.map((p) => [p.status, p.attempts[0].status])).toEqual([
      ["FAILED", "FAILED"],
      ["FAILED", "REVERSED"],
    ]);
  });

  it("insufficient balance defers a day; the third refusal alerts admins", async () => {
    const { orderId, due } = await releasedOrder();
    fakePaystack.transferMode = "insufficient";
    expect(await sendDuePayouts({ now: due })).toEqual({ sent: 0, deferred: 2 });
    let rows = await payouts(orderId);
    expect(rows.map((p) => [p.status, p.balanceRefusals, p.sendableAt.getTime()])).toEqual([
      ["QUEUED", 1, due.getTime() + 24 * HOUR],
      ["QUEUED", 1, due.getTime() + 24 * HOUR],
    ]);
    expect(rows[0].attempts.map((a) => [a.status, a.failureReason])).toEqual([["FAILED", "NO_FUNDS"]]);
    expect(await sendDuePayouts({ now: new Date(due.getTime() + HOUR) })).toEqual({ sent: 0, deferred: 0 });
    await sendDuePayouts({ now: new Date(due.getTime() + 24 * HOUR) });
    expect(fakeOutbox.sent.filter((m) => m.subject.includes("balance"))).toHaveLength(0);
    await sendDuePayouts({ now: new Date(due.getTime() + 48 * HOUR) });
    expect(fakeOutbox.sent.filter((m) => m.subject.includes("balance"))).toHaveLength(2);
    fakePaystack.transferMode = "success";
    await sendDuePayouts({ now: new Date(due.getTime() + 72 * HOUR) });
    rows = await payouts(orderId);
    expect(rows.map((p) => [p.status, p.attempts.length])).toEqual([
      ["PAID", 4],
      ["PAID", 4],
    ]);
    expect(rows[0].attempts.map((a) => a.transferReference)).toEqual([1, 2, 3, 4].map((n) => `${rows[0].reference}-${n}`));
  });

  it("a refund.failed webhook emails the admins", async () => {
    const { orderId } = await releasedOrder(30, 25);
    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId } });
    const { fakeWebhook } = await import("@/lib/paystack");
    const failed = fakeWebhook({ event: "refund.failed", data: { id: refund.paystackRefundId, status: "failed", amount: 32_500_000 } });
    expect(await handlePaystackWebhook(failed.rawBody, failed.signature)).toMatchObject({ outcome: "SETTLED" });
    const alerts = fakeOutbox.sent.filter((m) => m.subject.includes("refund failed"));
    expect(alerts.map((m) => m.to)).toEqual([`${w.admin.userId}@example.com`]);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("FAILED");
  });

  it("after every payout is PAID the ledger's payables are 0 and payouts plus fee equal paid minus refunds", async () => {
    const { orderId, due } = await releasedOrder(30, 25);
    await sendDuePayouts({ now: due });
    expect(await ledgerBalance(orderId, "COOPERATIVE_PAYABLE")).toBe(0);
    expect(await ledgerBalance(orderId, "FARMER_PAYABLE")).toBe(0);
    expect(await ledgerBalance(orderId, "HELD")).toBe(0);
    expect(await ledgerBalance(orderId)).toBe(0);
    const paid = (await payouts(orderId)).filter((p) => p.status === "PAID").reduce((n, p) => n + Number(p.amountKobo), 0);
    expect(paid + -(await ledgerBalance(orderId, "PLATFORM_FEE"))).toBe(195_000_000 - 32_500_000);
  });
});
