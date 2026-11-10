"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { requireActor } from "@/modules/identity/session";
import { retryPayout, unblockPayout } from "@/modules/payments/service";

const id = z.string().min(1).max(64);

async function run(payoutId: string, work: (payoutId: string) => Promise<void>): Promise<ActionResult> {
  try {
    await work(id.parse(payoutId));
    revalidatePath("/admin/payouts");
    revalidatePath("/admin/orders");
    return { ok: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, code: "PAYOUT_NOT_FOUND" };
    return toActionResult(error);
  }
}

// The actor always comes from the session; the payout's amount and account never come from the client.
export async function retryPayoutAction(payoutId: string): Promise<ActionResult> {
  return run(payoutId, async (payoutId) => retryPayout(await requireActor(), payoutId, { useCurrentAccount: false }));
}

export async function retryToCurrentAccountAction(payoutId: string): Promise<ActionResult> {
  return run(payoutId, async (payoutId) => retryPayout(await requireActor(), payoutId, { useCurrentAccount: true }));
}

export async function unblockPayoutAction(payoutId: string): Promise<ActionResult> {
  return run(payoutId, async (payoutId) => unblockPayout(await requireActor(), payoutId));
}
