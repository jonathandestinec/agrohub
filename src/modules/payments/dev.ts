import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { koboFromDb } from "@/lib/money";
import { fakeSettle, selectPaystack } from "@/lib/paystack";
import { sendDuePayouts } from "./sending";
import { handlePaystackWebhook } from "./webhook";

// Local development only: the fake Paystack's checkout page. Every function returns null (and
// does nothing) unless the fake is in use, so none of this can run on staging or production.
function fakeInUse(): boolean {
  return (
    env.APP_ENV === "local" &&
    process.env.NODE_ENV !== "production" &&
    selectPaystack({ appEnv: env.APP_ENV, nodeEnv: process.env.NODE_ENV, secretKey: env.PAYSTACK_SECRET_KEY }) === "fake"
  );
}

export async function fakeCheckoutDetails(reference: string): Promise<{ orderId: string; amountKobo: number } | null> {
  if (!fakeInUse()) return null;
  const payment = await prisma.payment.findUnique({ where: { reference }, select: { orderId: true, amountKobo: true } });
  return payment ? { orderId: payment.orderId, amountKobo: koboFromDb(payment.amountKobo) } : null;
}

// Settles the fake transaction and delivers its signed webhook through the real handler.
export async function settleFakeCheckout(reference: string, outcome: "success" | "failed"): Promise<{ orderId: string } | null> {
  const details = await fakeCheckoutDetails(reference);
  if (!details) return null;
  const { rawBody, signature } = fakeSettle(reference, outcome);
  if (outcome === "success") await handlePaystackWebhook(rawBody, signature);
  return { orderId: details.orderId };
}

/**
 * Local e2e only: runs the payouts of one order as the daily job would the day after payment
 * (now = paidAt + 25 h), since an end-to-end test cannot move the clock. Null unless the fake
 * Paystack is in use.
 */
export async function runFakePayouts(orderId: string): Promise<{ sent: number; deferred: number } | null> {
  if (!fakeInUse()) return null;
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { paidAt: true } });
  if (!order?.paidAt) return null;
  return sendDuePayouts({ orderId, now: new Date(order.paidAt.getTime() + 25 * 3_600_000) });
}
