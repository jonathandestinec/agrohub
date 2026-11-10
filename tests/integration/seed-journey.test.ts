import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { fakeOutbox } from "@/lib/email";
import { applyBps, koboFromDb, withinBps } from "@/lib/money";
import { availableQuantity } from "@/modules/catalog/service";
import { SEED, seed } from "../../prisma/seed";
import { cleanDatabase } from "./helpers";

async function clean() {
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verification.deleteMany();
  await cleanDatabase();
}

const big = (value: bigint | null | undefined) => koboFromDb(value ?? BigInt(0));

async function journeyCounts() {
  return {
    users: await prisma.user.count(),
    lots: await prisma.lot.count(),
    photos: await prisma.lotPhoto.count(),
    offers: await prisma.offer.count(),
    orders: await prisma.order.count(),
    reservations: await prisma.stockReservation.count(),
    payments: await prisma.payment.count(),
    refunds: await prisma.refund.count(),
    ledger: await prisma.ledgerEntry.count(),
    payouts: await prisma.payout.count(),
    attempts: await prisma.payoutAttempt.count(),
    disputes: await prisma.dispute.count(),
    threads: await prisma.thread.count(),
    messages: await prisma.message.count(),
    events: await prisma.paystackEvent.count(),
    audit: await prisma.auditLog.count(),
  };
}

// Each run hashes seven passwords and walks seven orders through the real services.
describe("seed: the Phase 3-5 demo journey", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    await clean();
    fakeOutbox.clear();
    await seed();
  }, 120_000);

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  async function ordersByStatus() {
    const orders = await prisma.order.findMany({
      include: { buyer: { select: { email: true } }, lot: { include: { crop: true } } },
      orderBy: { createdAt: "asc" },
    });
    return new Map<OrderStatus, (typeof orders)[number]>(orders.map((o) => [o.status, o]));
  }

  it("has an approved, published maize lot from the seeded cooperative with stock left, priced near the board", async () => {
    const cooperative = await prisma.cooperative.findUniqueOrThrow({
      where: { registrationNumber: SEED.cooperative.registrationNumber },
    });
    const lot = await prisma.lot.findFirstOrThrow({
      where: { cooperativeId: cooperative.id, crop: { name: "Maize" } },
      include: { feeTerms: true, photos: true, contributions: true, farmer: true },
    });
    expect(lot.status).toBe("LIVE");
    expect(lot.farmer.email).toBe(SEED.grower.email);
    expect(lot.approvedAt).not.toBeNull();
    expect(lot.feeTerms).toMatchObject({ cooperativeCutBps: 500, platformFeeBps: 300 });
    expect(lot.photos.length).toBeGreaterThan(0);
    expect(lot.contributions).toHaveLength(1);
    expect(lot.floorKobo).toBeLessThanOrEqual(lot.askKobo);
    // Within the 20% the board tolerates of the newest exchange price (₦32,635 a 100kg bag).
    expect(withinBps(lot.askKobo, 3_263_500, 2000)).toBe(true);
    expect(await availableQuantity(lot.id)).toBeGreaterThan(0);

    const live = await prisma.lot.findMany({ where: { status: "LIVE" } });
    expect(live.length).toBeGreaterThanOrEqual(4);
    for (const l of live) expect(l.approvedAt!.getTime()).toBeGreaterThan(l.createdAt.getTime());
  });

  it("has an accepted offer from the seeded buyer that is still open to pay", async () => {
    const offer = await prisma.offer.findFirstOrThrow({
      where: { status: "ACCEPTED" },
      include: { buyer: true, lot: { include: { crop: true } } },
    });
    expect(offer.buyer.email).toBe(SEED.buyer.email);
    expect(offer.lot.crop.name).toBe("Maize");
    expect(offer.agreedKobo).toBe(offer.offeredKobo);
    expect(offer.agreedKobo).toBeGreaterThanOrEqual(offer.lot.floorKobo);
    expect(offer.payByAt!.getTime()).toBeGreaterThan(Date.now() + 24 * 3_600_000);
    expect(await prisma.order.count({ where: { offerId: offer.id } })).toBe(0);
  });

  it("has one order at each stage", async () => {
    const byStatus = await ordersByStatus();
    expect([...byStatus.keys()].sort()).toEqual(
      ["PENDING_PAYMENT", "PAID_HELD", "PREPARING", "DELIVERED_MARKED", "COMPLETED", "REFUNDED", "DISPUTED"].sort(),
    );
    for (const order of byStatus.values()) {
      expect([SEED.buyer.email, SEED.buyerTwo.email]).toContain(order.buyer.email);
    }
  });

  it("every order's ledger balances, in total and in each group", async () => {
    const orders = await prisma.order.findMany();
    for (const order of orders) {
      const entries = await prisma.ledgerEntry.findMany({ where: { orderId: order.id } });
      expect(entries.reduce((sum, e) => sum + big(e.amountKobo), 0), order.status).toBe(0);
      const groups = new Map<string, number>();
      for (const e of entries) groups.set(e.groupId, (groups.get(e.groupId) ?? 0) + big(e.amountKobo));
      for (const sum of groups.values()) expect(sum).toBe(0);
    }
  });

  it("every order carries the lot's locked terms and a total that adds up", async () => {
    for (const order of await prisma.order.findMany({ include: { lot: { include: { feeTerms: true } } } })) {
      expect(order.cutBps).toBe(order.lot.feeTerms!.cooperativeCutBps);
      expect(order.feeBps).toBe(order.lot.feeTerms!.platformFeeBps);
      expect(big(order.totalKobo)).toBe(order.unitKobo * order.quantity + big(order.deliveryKobo));
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(big(payment.amountKobo)).toBe(big(order.totalKobo));
      expect(payment.reference).toMatch(/^pay_/);
    }
  });

  it("awaiting payment: an INITIALIZED payment, a reservation, nothing in the ledger, and not old enough to expire", async () => {
    const order = (await ordersByStatus()).get("PENDING_PAYMENT")!;
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment.status).toBe("INITIALIZED");
    expect(await prisma.stockReservation.count({ where: { orderId: order.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { orderId: order.id } })).toBe(0);
    // The unpaid-order job cancels checkouts 24 hours old; this one is minutes old.
    expect(Date.now() - order.createdAt.getTime()).toBeLessThan(3_600_000);
  });

  it("paid and delivered stages: payment succeeded and the whole total is held", async () => {
    const byStatus = await ordersByStatus();
    for (const status of ["PAID_HELD", "PREPARING", "DELIVERED_MARKED", "DISPUTED"] as const) {
      const order = byStatus.get(status)!;
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(payment.status, status).toBe("SUCCEEDED");
      expect(order.paidAt, status).not.toBeNull();
      const held = await prisma.ledgerEntry.aggregate({ where: { orderId: order.id, account: "HELD" }, _sum: { amountKobo: true } });
      expect(big(held._sum.amountKobo), status).toBe(-big(order.totalKobo));
      expect(await prisma.payout.count({ where: { orderId: order.id } }), status).toBe(0);
      expect(await prisma.stockReservation.count({ where: { orderId: order.id } }), status).toBe(0);
    }
    expect(byStatus.get("PREPARING")!.preparingAt).not.toBeNull();
    const delivered = byStatus.get("DELIVERED_MARKED")!;
    expect(delivered.deliveredQuantity).toBe(delivered.quantity);
    // Under the 72-hour auto-release, so a daily timers run does not complete it.
    expect(Date.now() - delivered.deliveredMarkedAt!.getTime()).toBeLessThan(72 * 3_600_000);
  });

  it("completed: released from the order's terms, with the payouts recorded and paid", async () => {
    const order = (await ordersByStatus()).get("COMPLETED")!;
    const goods = order.unitKobo * order.quantity;
    const cut = applyBps(goods, order.cutBps);
    const fee = applyBps(goods, order.feeBps);
    const payouts = await prisma.payout.findMany({ where: { orderId: order.id } });
    const cooperativePayout = payouts.filter((p) => p.recipientType === "COOPERATIVE");
    const farmerPayouts = payouts.filter((p) => p.recipientType === "FARMER");
    expect(cooperativePayout.map((p) => big(p.amountKobo))).toEqual([cut + big(order.deliveryKobo)]);
    expect(farmerPayouts.map((p) => big(p.amountKobo))).toEqual([goods - cut - fee]);
    expect(payouts.every((p) => p.status === "PAID" && p.paidAt !== null)).toBe(true);
    expect(await prisma.payoutAttempt.count({ where: { payout: { orderId: order.id }, status: "SUCCEEDED" } })).toBe(payouts.length);

    const sum = async (account: "HELD" | "PLATFORM_FEE" | "COOPERATIVE_PAYABLE" | "FARMER_PAYABLE") =>
      big((await prisma.ledgerEntry.aggregate({ where: { orderId: order.id, account }, _sum: { amountKobo: true } }))._sum.amountKobo);
    expect(await sum("HELD")).toBe(0);
    expect(await sum("COOPERATIVE_PAYABLE")).toBe(0);
    expect(await sum("FARMER_PAYABLE")).toBe(0);
    expect(await sum("PLATFORM_FEE")).toBe(-fee);
    expect(payouts.reduce((s, p) => s + big(p.amountKobo), 0) + fee).toBe(big(order.totalKobo));
    expect(order.completedAt).not.toBeNull();
  });

  it("refunded: the buyer cancelled, the full total went back and Paystack's refund was settled", async () => {
    const order = (await ordersByStatus()).get("REFUNDED")!;
    const refunds = await prisma.refund.findMany({ where: { orderId: order.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ status: "PROCESSED", reason: "BUYER_CANCEL", purpose: "cancel" });
    expect(big(refunds[0].amountKobo)).toBe(big(order.totalKobo));
    const held = await prisma.ledgerEntry.aggregate({ where: { orderId: order.id, account: "HELD" }, _sum: { amountKobo: true } });
    expect(big(held._sum.amountKobo)).toBe(0);
    expect(await prisma.payout.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("disputed: the buyer's report is open for an admin and the money is still held", async () => {
    const order = (await ordersByStatus()).get("DISPUTED")!;
    const disputes = await prisma.dispute.findMany({ where: { orderId: order.id } });
    expect(disputes).toHaveLength(1);
    expect(disputes[0]).toMatchObject({ kind: "REPORT", status: "OPEN", outcome: null });
    expect(disputes[0].reason.length).toBeGreaterThan(4);
  });

  it("uses only fake accounts, references and addresses", async () => {
    const codes = [
      ...(await prisma.farmerProfile.findMany({ select: { recipientCode: true } })).map((p) => p.recipientCode),
      ...(await prisma.cooperative.findMany({ select: { recipientCode: true } })).map((c) => c.recipientCode),
    ].filter((code): code is string => code !== null);
    expect(codes.length).toBeGreaterThanOrEqual(2);
    for (const code of codes) expect(code).toMatch(/^RCP_seed/);
    for (const user of await prisma.user.findMany()) {
      expect(user.email).toMatch(/^seed-.*@example\.com$/);
      expect(user.phone).toBe(SEED.phone);
    }
  });

  it("a second run changes nothing", async () => {
    const before = await journeyCounts();
    const orderRows = await prisma.order.findMany({ select: { id: true, status: true }, orderBy: { id: "asc" } });
    const second = await seed();
    expect(second.password).toBeNull();
    expect(await journeyCounts()).toEqual(before);
    expect(await prisma.order.findMany({ select: { id: true, status: true }, orderBy: { id: "asc" } })).toEqual(orderRows);
  });

  it("a re-run after the unpaid-order job expired the awaiting-payment order puts a fresh one in its place", async () => {
    const order = (await ordersByStatus()).get("PENDING_PAYMENT")!;
    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED", cancelReason: "PAYMENT_EXPIRED" } });
    await prisma.stockReservation.deleteMany({ where: { orderId: order.id } });
    await seed();
    const fresh = (await ordersByStatus()).get("PENDING_PAYMENT")!;
    expect(fresh.id).not.toBe(order.id);
    expect(await prisma.order.count({ where: { status: "CANCELLED" } })).toBe(1);
    // Putting things back for the tests after this one.
    await seed();
    expect(await prisma.order.count({ where: { status: "PENDING_PAYMENT" } })).toBe(1);
  });
});
