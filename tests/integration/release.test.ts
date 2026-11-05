import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fakeOutbox } from "@/lib/email";
import { prisma } from "@/lib/db";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { leaveCooperative } from "@/modules/farmers/service";
import { completeOrder, markDelivered } from "@/modules/orders/service";
import { ledgerBalance } from "@/modules/payments/service";
import { cleanDatabase } from "./helpers";
import { farmerMember } from "./lot-fixtures";
import { HOUR, paidOrder, paidWorld, type PaidWorld } from "./paid-order";

let w: PaidWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  fakeOutbox.clear();
});

afterAll(cleanDatabase);

const payouts = (orderId: string) =>
  prisma.payout.findMany({ where: { orderId }, orderBy: [{ recipientType: "asc" }, { recipientId: "asc" }, { part: "asc" }] });

// Delivered and confirmed; returns the order id and its payment time.
async function released(quantity: number, delivered = quantity, at = new Date()) {
  const { orderId, paidAt } = await paidOrder(w, quantity, at);
  await markDelivered(w.officer, orderId, delivered, at);
  expect(await completeOrder(orderId, "BUYER", at)).toBe(true);
  return { orderId, paidAt };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const kobo = (rows: Array<{ amountKobo: bigint }>) => rows.map((r) => Number(r.amountKobo));

describe("completeOrder", () => {
  it("creates one QUEUED payout per recipient, sendable 24 h after payment, and balances the ledger", async () => {
    w = await paidWorld();
    const at = new Date();
    const { orderId, paidAt } = await released(30, 30, at);
    const rows = await payouts(orderId);
    expect(rows.map((p) => [p.recipientType, p.recipientId, Number(p.amountKobo), p.status, p.part])).toEqual([
      ["COOPERATIVE", w.cooperativeId, 12_250_000 - 2_500_000, "QUEUED", 1],
      ["FARMER", w.farmer.userId, 179_400_000, "QUEUED", 1],
    ]);
    for (const p of rows) expect(p.sendableAt).toEqual(new Date(paidAt.getTime() + 24 * HOUR));
    expect(rows[1].recipientCode).toBe(`RCP_${w.farmer.userId}`);
    expect(await ledgerBalance(orderId, "HELD")).toBe(0);
    expect(await ledgerBalance(orderId, "COOPERATIVE_PAYABLE")).toBe(-9_750_000);
    expect(await ledgerBalance(orderId, "FARMER_PAYABLE")).toBe(-179_400_000);
    expect(await ledgerBalance(orderId, "PLATFORM_FEE")).toBe(-5_850_000);
    expect(await ledgerBalance(orderId)).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: orderId, action: "order.completed" } });
    expect(audit.meta).toMatchObject({ orderId, by: "BUYER", deliveredQuantity: 30, refundKobo: 0 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).completedAt).toEqual(at);
  });

  it("refunds a shortfall of 25 of 30 and pays on the delivered units", async () => {
    w = await paidWorld();
    const { orderId } = await released(30, 25);
    const refunds = await prisma.refund.findMany({ where: { orderId } });
    expect(refunds.map((r) => [r.purpose, r.reason, Number(r.amountKobo)])).toEqual([["shortfall", "SHORTFALL", 32_500_000]]);
    expect(fakePaystack.refunds.map((r) => r.amountKobo)).toEqual([32_500_000]);
    const rows = await payouts(orderId);
    expect(kobo(rows)).toEqual([8_125_000, 149_500_000]);
    expect(sum(kobo(rows)) + 4_875_000).toBe(195_000_000 - 32_500_000);
    expect(await ledgerBalance(orderId, "HELD")).toBe(0);
    expect(await ledgerBalance(orderId)).toBe(0);
  });

  it("adds the delivery cost to the cooperative's payout", async () => {
    w = await paidWorld();
    const { quoteDelivery } = await import("@/modules/orders/service");
    const { ensureBuyerThread } = await import("@/modules/messaging/service");
    await ensureBuyerThread(w.lotId, w.buyer.userId);
    const { quoteId } = await quoteDelivery(w.officer, { lotId: w.lotId, buyerUserId: w.buyer.userId, amountKobo: 2_500_000 });
    const at = new Date();
    const { orderId } = await paidOrder(w, 30, at, { deliveryQuoteId: quoteId });
    await markDelivered(w.officer, orderId, 30, at);
    await completeOrder(orderId, "BUYER", at);
    expect(kobo(await payouts(orderId))).toEqual([12_250_000, 179_400_000]);
    expect(await ledgerBalance(orderId)).toBe(0);
  });

  it("splits farmers' shares by contribution (3 and 4)", async () => {
    w = await paidWorld({ quantity: 7, askKobo: 33_333, cutBps: 250 });
    const second = await farmerMember("u-farmer-2", w.cooperativeId);
    await prisma.lotContribution.updateMany({ where: { lotId: w.lotId }, data: { quantity: 3 } });
    await prisma.lotContribution.create({ data: { lotId: w.lotId, farmerUserId: second.userId, quantity: 4 } });
    const { orderId } = await released(7);
    const farmers = (await payouts(orderId)).filter((p) => p.recipientType === "FARMER");
    const byFarmer = Object.fromEntries(farmers.map((p) => [p.recipientId, Number(p.amountKobo)]));
    const first = await prisma.lotContribution.findFirstOrThrow({ where: { lotId: w.lotId, farmerUserId: w.farmer.userId } });
    const other = await prisma.lotContribution.findFirstOrThrow({ where: { lotId: w.lotId, farmerUserId: second.userId } });
    // splitByWeights follows the contributions in id order; the remainder kobo goes to the larger weight.
    expect(first.id < other.id).toBe(true);
    expect(byFarmer).toEqual({ [w.farmer.userId]: 94_500, [second.userId]: 125_999 });
  });

  it("large_share_is_split_into_transfer_parts", async () => {
    w = await paidWorld({ quantity: 100, askKobo: 50_000_000, cutBps: 0 });
    const { orderId } = await released(100);
    const farmer = (await payouts(orderId)).filter((p) => p.recipientType === "FARMER");
    expect(farmer.map((p) => [p.part, Number(p.amountKobo)])).toEqual([1, 2, 3, 4, 5].map((part) => [part, 970_000_000]));
    expect(new Set(farmer.map((p) => p.reference)).size).toBe(5);
    expect(farmer[0].reference).toBe(`po_${orderId}_f_${w.farmer.userId}_1`);
    // A cut of 0 and pickup: the cooperative is owed nothing, so it has no payout.
    expect((await payouts(orderId)).filter((p) => p.recipientType === "COOPERATIVE")).toEqual([]);
  });

  it("payout_during_bank_change_wait_uses_old_account", async () => {
    w = await paidWorld();
    const profile = await prisma.farmerProfile.findUniqueOrThrow({ where: { userId: w.farmer.userId } });
    const T = new Date(Date.now() - 50 * HOUR);
    await prisma.bankChangeRequest.create({
      data: {
        ownerType: "FARMER",
        ownerId: profile.id,
        newRecipientCode: "RCP_NEW",
        newAccountName: "FARMER",
        newBankName: "Bank",
        requestedBy: w.farmer.userId,
        confirmToken: "tok-1",
        confirmedAt: T,
        effectiveAt: new Date(T.getTime() + 48 * HOUR),
      },
    });
    const before = await paidOrder(w, 10, new Date(T.getTime() - HOUR));
    await markDelivered(w.officer, before.orderId, 10, T);
    await completeOrder(before.orderId, "BUYER", new Date(T.getTime() + 47 * HOUR));
    const after = await paidOrder(w, 10, new Date(T.getTime() - HOUR));
    await markDelivered(w.officer, after.orderId, 10, T);
    await completeOrder(after.orderId, "BUYER", new Date(T.getTime() + 48 * HOUR));
    const code = async (orderId: string) =>
      (await prisma.payout.findFirstOrThrow({ where: { orderId, recipientType: "FARMER" } })).recipientCode;
    expect(await code(before.orderId)).toBe(`RCP_${w.farmer.userId}`);
    expect(await code(after.orderId)).toBe("RCP_NEW");
  });

  it("farmer_without_recipient_is_blocked_not_skipped", async () => {
    w = await paidWorld();
    await prisma.farmerProfile.update({ where: { userId: w.farmer.userId }, data: { recipientCode: null, accountName: null } });
    await prisma.cooperative.update({ where: { id: w.cooperativeId }, data: { recipientCode: "RCP_COOP" } });
    await prisma.membership.create({ data: { userId: w.admin.userId, role: "ADMIN", status: "ACTIVE" } });
    const { orderId } = await released(30);
    const rows = await payouts(orderId);
    expect(rows.map((p) => [p.recipientType, p.status, Number(p.amountKobo), p.recipientCode])).toEqual([
      ["COOPERATIVE", "QUEUED", 9_750_000, "RCP_COOP"],
      ["FARMER", "BLOCKED", 179_400_000, null],
    ]);
    const alerts = fakeOutbox.sent.filter((m) => m.subject.includes("payout"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].to).toBe(`${w.admin.userId}@example.com`);
    expect(alerts[0].html).not.toContain("RCP_");
  });

  it("completes once, even called twice at once", async () => {
    w = await paidWorld();
    const { orderId } = await paidOrder(w, 30);
    await markDelivered(w.officer, orderId, 30);
    const now = new Date();
    const results = await Promise.all([completeOrder(orderId, "BUYER", now), completeOrder(orderId, "AUTO", now)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await completeOrder(orderId, "BUYER", now)).toBe(false);
    expect(await payouts(orderId)).toHaveLength(2);
    const groups = await prisma.ledgerEntry.groupBy({ by: ["groupId"], where: { orderId, kind: "order.released" } });
    expect(groups).toHaveLength(1);
  });

  it("a farmer with a queued payout cannot leave the cooperative", async () => {
    w = await paidWorld();
    await released(30);
    await expect(leaveCooperative(w.farmer)).rejects.toMatchObject({ code: "UNFINISHED_ORDERS" });
    await prisma.payout.updateMany({ where: { recipientType: "FARMER" }, data: { status: "PAID", paidAt: new Date() } });
    await leaveCooperative(w.farmer);
  });
});
