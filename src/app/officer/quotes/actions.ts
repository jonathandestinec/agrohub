"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { toKobo } from "@/lib/money";
import { requireActor } from "@/modules/identity/session";
import { quoteDeliveryInThread } from "@/modules/orders/service";

const id = z.string().min(1).max(64);

// amount is naira as typed ("25000", "25,000.50").
export async function quoteDeliveryAction(input: { threadId: string; amount: string; note: string }): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const threadId = id.parse(input.threadId);
    let amountKobo: number;
    try {
      amountKobo = toKobo(input.amount.trim().replace(/,/g, ""));
    } catch {
      throw new ValidationError("Invalid amount", "INVALID_AMOUNT");
    }
    await quoteDeliveryInThread(actor, threadId, { amountKobo, note: input.note.trim() || undefined });
    revalidatePath(`/messages/${threadId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, code: "INVALID_CHECKOUT" };
    return toActionResult(error);
  }
}
