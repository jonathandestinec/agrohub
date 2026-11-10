"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import type { Actor } from "@/modules/identity/policies";
import { requireActor } from "@/modules/identity/session";
import { payoutOutcome, retryPayout, unblockPayout, type PayoutOutcome } from "@/modules/payments/service";

const id = z.string().min(1).max(64);

// Does the work, then reports what the payout is afterwards so the page can say what happened.
async function run(
  payoutId: string,
  work: (actor: Actor, payoutId: string) => Promise<void>,
): Promise<ActionResult<PayoutOutcome>> {
  try {
    const actor = await requireActor();
    const parsed = id.parse(payoutId);
    await work(actor, parsed);
    const outcome = await payoutOutcome(actor, parsed);
    revalidatePath("/admin/payouts");
    revalidatePath("/admin/orders");
    return { ok: true, data: outcome };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, code: "PAYOUT_NOT_FOUND" };
    return toActionResult(error);
  }
}

// The actor always comes from the session; the payout's amount and account never come from the client.
export async function retryPayoutAction(payoutId: string): Promise<ActionResult<PayoutOutcome>> {
  return run(payoutId, (actor, id) => retryPayout(actor, id, { useCurrentAccount: false }));
}

export async function retryToCurrentAccountAction(payoutId: string): Promise<ActionResult<PayoutOutcome>> {
  return run(payoutId, (actor, id) => retryPayout(actor, id, { useCurrentAccount: true }));
}

export async function unblockPayoutAction(payoutId: string): Promise<ActionResult<PayoutOutcome>> {
  return run(payoutId, (actor, id) => unblockPayout(actor, id));
}
