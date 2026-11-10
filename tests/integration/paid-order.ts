import { prisma } from "@/lib/db";
import { fakeSettle } from "@/lib/paystack";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { startCheckout } from "@/modules/orders/service";
import { confirmPayment } from "@/modules/payments/service";
import { buyerMember, lotWorld, NOW, PHOTO, type LotWorld } from "./lot-fixtures";

export const HOUR = 3_600_000;

export type PaidWorld = LotWorld & { buyer: Actor; lotId: string };

// The lot world with the plan's terms (cut 5%, fee 3%) and a live lot of `quantity` bags at
// ₦65,000 (minimum order 1), plus an active buyer. The cooperative has a payout account.
export async function paidWorld(options: { quantity?: number; askKobo?: number; cutBps?: number } = {}): Promise<PaidWorld> {
  const w = await lotWorld();
  await prisma.cooperative.update({ where: { id: w.cooperativeId }, data: { cutBps: options.cutBps ?? 500, recipientCode: "RCP_COOP", accountName: "ZARIA GROWERS" } });
  const askKobo = options.askKobo ?? 6_500_000;
  const lot = await submitLot(w.farmer, w.input({ quantity: options.quantity ?? 30, askKobo, floorKobo: askKobo - 100 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
  const buyer = await buyerMember("u-buyer");
  return { ...w, buyer, lotId: lot.id };
}

// Checks out `quantity` at `at` (optionally with a delivery quote) and confirms the payment a
// minute later through Paystack's (fake) verification, as the webhook does.
export async function paidOrder(
  w: PaidWorld,
  quantity: number,
  at: Date = new Date(),
  options: { buyer?: Actor; deliveryQuoteId?: string } = {},
): Promise<{ orderId: string; reference: string; paidAt: Date }> {
  const { orderId } = await startCheckout(
    options.buyer ?? w.buyer,
    { source: "LOT", lotId: w.lotId, quantity, deliveryQuoteId: options.deliveryQuoteId },
    at,
  );
  const { reference } = await prisma.payment.findFirstOrThrow({ where: { orderId } });
  fakeSettle(reference, "success");
  const paidAt = new Date(at.getTime() + 60_000);
  const outcome = await confirmPayment(reference, paidAt);
  if (outcome !== "PAID") throw new Error(`payment not confirmed: ${outcome}`);
  return { orderId, reference, paidAt };
}
