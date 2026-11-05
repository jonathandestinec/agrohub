"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { requireActor } from "@/modules/identity/session";
import { cancelOrder, confirmReceipt, startCheckout } from "@/modules/orders/service";

const id = z.string().min(1).max(64);

// Starts paying for a lot (at the asking price) or an accepted offer. The browser is then sent
// to Paystack's page; the order is marked paid only by Paystack's webhook.
export async function startCheckoutAction(input: {
  source: "LOT" | "OFFER";
  lotId?: string;
  offerId?: string;
  quantity?: string;
  deliveryQuoteId?: string;
}): Promise<ActionResult<{ orderId: string; authorizationUrl: string }>> {
  try {
    const actor = await requireActor();
    const quoteId = input.deliveryQuoteId ? id.parse(input.deliveryQuoteId) : undefined;
    let result;
    if (input.source === "OFFER") {
      result = await startCheckout(actor, { source: "OFFER", offerId: id.parse(input.offerId), deliveryQuoteId: quoteId });
    } else {
      const quantity = (input.quantity ?? "").trim();
      if (!/^\d{1,7}$/.test(quantity)) throw new ValidationError("Invalid quantity", "INVALID_QUANTITY");
      result = await startCheckout(actor, {
        source: "LOT",
        lotId: id.parse(input.lotId),
        quantity: Number(quantity),
        deliveryQuoteId: quoteId,
      });
    }
    revalidatePath("/buyer/orders");
    return { ok: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, code: "INVALID_CHECKOUT" };
    return toActionResult(error);
  }
}

async function runOrderAction(orderId: string, work: (orderId: string) => Promise<void>): Promise<ActionResult> {
  try {
    const parsed = id.parse(orderId);
    await work(parsed);
    revalidatePath(`/buyer/orders/${parsed}`);
    revalidatePath("/buyer/orders");
    return { ok: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, code: "ORDER_NOT_FOUND" };
    return toActionResult(error);
  }
}

// The buyer confirms they received a delivered order; the payment is released.
export async function confirmReceiptAction(orderId: string): Promise<ActionResult> {
  return runOrderAction(orderId, async (orderId) => confirmReceipt(await requireActor(), orderId));
}

// Cancels a paid order not yet being prepared (full refund), or asks the cooperative to cancel one it is preparing.
export async function cancelOrderAction(orderId: string, reason: string): Promise<ActionResult> {
  return runOrderAction(orderId, async (orderId) => cancelOrder(await requireActor(), orderId, String(reason ?? "")));
}
