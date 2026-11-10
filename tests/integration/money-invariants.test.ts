import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack, fakeSettle, fakeWebhook } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { ensureBuyerThread } from "@/modules/messaging/service";
import {
  cancelOrder,
  confirmReceipt,
  markDelivered,
  quoteDelivery,
  reportProblem,
  resolveDispute,
  startCheckout,
} from "@/modules/orders/service";
import { confirmPayment, handlePaystackWebhook, ledgerBalance, sendDuePayouts } from "@/modules/payments/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, farmerMember, lotWorld, NOW, PHOTO } from "./lot-fixtures";

const HOUR = 3_600_000;
const MIN = 60_000;
const PATHS = ["complete", "shortfall", "buyerCancel", "cooperativeCancel", "refundAll", "refundUnits", "lateDuplicate"] as const;
type Path = (typeof PATHS)[number];

afterAll(cleanDatabase);

const scenario = fc.record({
  unitKobo: fc.integer({ min: 1, max: 100_000_000 }),
  quantity: fc.integer({ min: 1, max: 200 }),
  cutBps: fc.integer({ min: 0, max: 500 }),
  feeBps: fc.integer({ min: 0, max: 1000 }),
  deliveryKobo: fc.integer({ min: 0, max: 5_000_000 }),
  contributors: fc.integer({ min: 1, max: 3 }),
  weights: fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 3, maxLength: 3 }),
  path: fc.constantFrom(...PATHS),
  pick: fc.integer({ min: 0, max: 1_000_000 }),
});

type Scenario = { unitKobo: number; quantity: number; cutBps: number; feeBps: number; deliveryKobo: number; contributors: number; weights: number[]; path: Path; pick: number };

// One lot whose contributions split its quantity among 1 to 3 farmers, with the scenario's cut
// and fee locked on it.
async function world(s: Scenario) {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  const w = await lotWorld();
  await prisma.cooperative.update({ where: { id: w.cooperativeId }, data: { recipientCode: "RCP_COOP" } });
  await prisma.membership.create({ data: { userId: w.admin.userId, role: "ADMIN", status: "ACTIVE" } });
  const lot = await submitLot(w.farmer, w.input({ quantity: s.quantity, askKobo: s.unitKobo, floorKobo: s.unitKobo }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
  await prisma.lotFeeTerms.update({ where: { lotId: lot.id }, data: { cooperativeCutBps: s.cutBps, platformFeeBps: s.feeBps } });
  // Contributions: the scenario's weights scaled to the lot quantity, at least 1 each.
  const n = Math.min(s.contributors, s.quantity);
  const weights = s.weights.slice(0, n);
  const total = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((x) => Math.max(1, Math.floor((x * s.quantity) / total)));
  shares[0] += s.quantity - shares.reduce((a, b) => a + b, 0);
  if (shares[0] < 1) {
    shares.fill(1);
    shares[0] = s.quantity - (n - 1);
  }
  await prisma.lotContribution.updateMany({ where: { lotId: lot.id }, data: { quantity: shares[0] } });
  for (let i = 1; i < n; i += 1) {
    const f = await farmerMember(`u-farmer-${i}`, w.cooperativeId);
    await prisma.lotContribution.create({ data: { lotId: lot.id, farmerUserId: f.userId, quantity: shares[i] } });
  }
  const buyer = await buyerMember("u-buyer");
  const second = await buyerMember("u-buyer-2");
  return { ...w, lotId: lot.id, buyer, second };
}

async function pay(buyer: Actor, lotId: string, quantity: number, at: Date, quoteId?: string) {
  const { orderId } = await startCheckout(buyer, { source: "LOT", lotId, quantity, deliveryQuoteId: quoteId }, at);
  const { reference } = await prisma.payment.findFirstOrThrow({ where: { orderId } });
  fakeSettle(reference, "success");
  return { orderId, reference };
}

async function settleEverything(now: Date) {
  for (const refund of await prisma.refund.findMany({ where: { status: "PENDING" } })) {
    const hook = fakeWebhook({ event: "refund.processed", data: { id: refund.paystackRefundId, status: "processed", amount: Number(refund.amountKobo) } });
    await handlePaystackWebhook(hook.rawBody, hook.signature);
  }
  await sendDuePayouts({ now: new Date(now.getTime() + 25 * HOUR) });
}

async function drive(s: Scenario) {
  const w = await world(s);
  const at = new Date(Date.now() - 2 * HOUR);
  let quoteId: string | undefined;
  if (s.deliveryKobo > 0) {
    await ensureBuyerThread(w.lotId, w.buyer.userId);
    quoteId = (await quoteDelivery(w.officer, { lotId: w.lotId, buyerUserId: w.buyer.userId, amountKobo: s.deliveryKobo }, at)).quoteId;
  }
  const note = "Checked the thread and the photos.";
  const path = s.path;
  if (path === "lateDuplicate") {
    // The first checkout's 15 minutes lapse, another buyer takes the whole lot, both pay; the
    // later confirmation is refunded in full.
    const first = await pay(w.buyer, w.lotId, s.quantity, at, quoteId);
    const second = await pay(w.second, w.lotId, s.quantity, new Date(at.getTime() + 16 * MIN));
    expect(await confirmPayment(second.reference, new Date(at.getTime() + 17 * MIN))).toBe("PAID");
    expect(await confirmPayment(first.reference, new Date(at.getTime() + 18 * MIN))).toBe("REFUNDING");
    // The paid one goes on to completion, so its money is released too.
    await markDelivered(w.officer, second.orderId, s.quantity, new Date(at.getTime() + 19 * MIN));
    await confirmReceipt(w.second, second.orderId, new Date(at.getTime() + 19 * MIN));
    await settleEverything(at);
    return [first.orderId, second.orderId];
  }
  const { orderId, reference } = await pay(w.buyer, w.lotId, s.quantity, at, quoteId);
  expect(await confirmPayment(reference, new Date(at.getTime() + MIN))).toBe("PAID");
  const later = new Date(at.getTime() + 2 * MIN);
  const short = s.quantity > 1 ? 1 + (s.pick % (s.quantity - 1)) : s.quantity;
  switch (path) {
    case "complete":
      await markDelivered(w.officer, orderId, s.quantity, later);
      await confirmReceipt(w.buyer, orderId, later);
      break;
    case "shortfall":
      await markDelivered(w.officer, orderId, short, later);
      await confirmReceipt(w.buyer, orderId, later);
      break;
    case "buyerCancel":
      await cancelOrder(w.buyer, orderId, "", later);
      break;
    case "cooperativeCancel":
      await cancelOrder(w.officer, orderId, "We cannot supply this order", later);
      break;
    case "refundAll":
    case "refundUnits": {
      await markDelivered(w.officer, orderId, s.quantity, later);
      await reportProblem(w.buyer, orderId, "Some bags were spoiled", later);
      const dispute = await prisma.dispute.findFirstOrThrow({ where: { orderId, status: "OPEN" } });
      if (path === "refundUnits" && s.quantity > 1) {
        await resolveDispute(w.admin, dispute.id, { outcome: "REFUND_UNITS", unitsRefunded: short === s.quantity ? 1 : short, note }, later);
      } else {
        await resolveDispute(w.admin, dispute.id, { outcome: "REFUND_ALL", note }, later);
      }
      break;
    }
  }
  await settleEverything(at);
  return [orderId];
}

async function assertInvariants(orderId: string) {
  expect(await ledgerBalance(orderId)).toBe(0);
  for (const account of ["HELD", "COOPERATIVE_PAYABLE", "FARMER_PAYABLE", "REFUND_PAYABLE"] as const) {
    expect(await ledgerBalance(orderId, account), account).toBe(0);
  }
  const paid = await prisma.payment.aggregate({ where: { orderId, status: "SUCCEEDED" }, _sum: { amountKobo: true } });
  const refunded = await prisma.refund.aggregate({ where: { orderId, status: "PROCESSED" }, _sum: { amountKobo: true } });
  const payouts = await prisma.payout.findMany({ where: { orderId }, include: { attempts: true } });
  const paidOut = payouts.filter((p) => p.status === "PAID").reduce((sum, p) => sum + Number(p.amountKobo), 0);
  const fee = -(await ledgerBalance(orderId, "PLATFORM_FEE"));
  expect(paidOut + fee).toBe(Number(paid._sum.amountKobo ?? 0) - Number(refunded._sum.amountKobo ?? 0));
  const keys = payouts.map((p) => `${p.recipientType}:${p.recipientId}:${p.part}`);
  expect(new Set(keys).size).toBe(keys.length);
  for (const p of payouts) {
    expect(p.status).toBe("PAID");
    expect(p.attempts.filter((a) => a.status === "SUCCEEDED")).toHaveLength(1);
  }
}

describe("money invariants across every order path", () => {
  it("ledger sums to zero, nothing left held or payable, payouts plus fee equal paid minus refunds", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const orders = await drive(s as Scenario);
        for (const orderId of orders) await assertInvariants(orderId);
      }),
      { numRuns: 25 },
    );
  }, 600_000);
});
