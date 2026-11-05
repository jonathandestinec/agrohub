import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack, fakeSettle, fakeWebhook } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { startCheckout } from "@/modules/orders/service";
import { confirmPayment, handlePaystackWebhook, ledgerBalance, postLedger } from "@/modules/payments/service";
import { cleanDatabase } from "./helpers";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

const MIN = 60_000;
const T = 65_000_000;
const FEE = 200_000;
let w: LotWorld;
let a: Actor;
let b: Actor;
let lotId: string;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  w = await lotWorld();
  a = await buyerMember("u-a");
  b = await buyerMember("u-b");
  const lot = await submitLot(w.farmer, w.input({ quantity: 10 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
  lotId = lot.id;
});

afterAll(cleanDatabase);

async function paid(who: Actor, when: Date) {
  const { orderId } = await startCheckout(who, { source: "LOT", lotId, quantity: 10 }, when);
  const { reference } = await prisma.payment.findFirstOrThrow({ where: { orderId } });
  fakeSettle(reference, "success");
  return { orderId, reference };
}

async function balances(orderId: string) {
  return {
    PAYSTACK_BALANCE: await ledgerBalance(orderId, "PAYSTACK_BALANCE"),
    HELD: await ledgerBalance(orderId, "HELD"),
    PAYSTACK_FEES: await ledgerBalance(orderId, "PAYSTACK_FEES"),
    REFUND_PAYABLE: await ledgerBalance(orderId, "REFUND_PAYABLE"),
    total: await ledgerBalance(orderId),
  };
}

describe("ledger", () => {
  it("after a payment: Paystack holds the total less its fee, which AgroHub absorbs", async () => {
    const { orderId, reference } = await paid(a, new Date());
    await confirmPayment(reference);
    expect(await balances(orderId)).toEqual({
      PAYSTACK_BALANCE: T - FEE,
      HELD: -T,
      PAYSTACK_FEES: FEE,
      REFUND_PAYABLE: 0,
      total: 0,
    });
  });

  it("after a late payment is refunded and the refund processed, nothing is held", async () => {
    const t0 = new Date(Date.now() - 20 * MIN);
    const late = await paid(a, t0);
    const prompt = await paid(b, new Date(t0.getTime() + 16 * MIN));
    await confirmPayment(prompt.reference);
    await confirmPayment(late.reference);
    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId: late.orderId } });
    const done = fakeWebhook({ event: "refund.processed", data: { id: refund.paystackRefundId, status: "processed", amount: T } });
    await handlePaystackWebhook(done.rawBody, done.signature);
    expect(await balances(late.orderId)).toEqual({
      PAYSTACK_BALANCE: -FEE,
      HELD: 0,
      PAYSTACK_FEES: FEE,
      REFUND_PAYABLE: 0,
      total: 0,
    });
    for (const orderId of [late.orderId, prompt.orderId]) expect(await ledgerBalance(orderId)).toBe(0);
  });

  it("refuses unbalanced groups", async () => {
    await expect(
      prisma.$transaction((tx) =>
        postLedger(tx, { orderId: "o-x", kind: "payment.captured", lines: [{ account: "HELD", amountKobo: 2 }, { account: "PAYSTACK_BALANCE", amountKobo: -1 }] }),
      ),
    ).rejects.toThrow("LEDGER_UNBALANCED");
    expect(await prisma.ledgerEntry.count({ where: { orderId: "o-x" } })).toBe(0);
  });

  it("is append-only even for raw SQL", async () => {
    const { reference } = await paid(a, new Date());
    await confirmPayment(reference);
    await expect(prisma.$executeRawUnsafe(`UPDATE "ledger_entry" SET "amountKobo" = 0`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ledger_entry"`)).rejects.toThrow();
  });
});
