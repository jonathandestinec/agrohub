"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { requireActor } from "@/modules/identity/session";
import { answerCancelRequest, cancelOrder, markDelivered, setDeliveryDate, startPreparing } from "@/modules/orders/service";

const id = z.string().min(1).max(64);

async function run(orderId: string, work: (orderId: string) => Promise<void>): Promise<ActionResult> {
  try {
    const parsed = id.parse(orderId);
    await work(parsed);
    revalidatePath(`/officer/orders/${parsed}`);
    revalidatePath("/officer/orders");
    return { ok: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, code: "ORDER_NOT_FOUND" };
    return toActionResult(error);
  }
}

export async function startPreparingAction(orderId: string): Promise<ActionResult> {
  return run(orderId, async (orderId) => startPreparing(await requireActor(), orderId));
}

// date is the browser's date input value, YYYY-MM-DD (a Lagos calendar day).
export async function setDeliveryDateAction(orderId: string, date: string): Promise<ActionResult> {
  return run(orderId, async (orderId) => setDeliveryDate(await requireActor(), orderId, date.trim()));
}

export async function markDeliveredAction(orderId: string, quantity: string): Promise<ActionResult> {
  return run(orderId, async (orderId) => {
    const text = quantity.trim();
    if (!/^\d{1,7}$/.test(text)) throw new ValidationError("Invalid quantity", "INVALID_QUANTITY");
    await markDelivered(await requireActor(), orderId, Number(text));
  });
}

export async function cancelOrderAction(orderId: string, reason: string): Promise<ActionResult> {
  return run(orderId, async (orderId) => cancelOrder(await requireActor(), orderId, String(reason ?? "")));
}

export async function answerCancelRequestAction(orderId: string, agree: boolean): Promise<ActionResult> {
  return run(orderId, async (orderId) => answerCancelRequest(await requireActor(), orderId, agree === true));
}
