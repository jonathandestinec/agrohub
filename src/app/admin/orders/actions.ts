"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { requireActor } from "@/modules/identity/session";
import { resolveDispute } from "@/modules/orders/service";

const id = z.string().min(1).max(64);
const outcome = z.enum(["RELEASE", "REFUND_ALL", "REFUND_UNITS", "NOTE"]);

// The actor always comes from the session; amounts come from the order, never from the client.
export async function resolveDisputeAction(input: {
  orderId: string;
  disputeId: string;
  outcome: string;
  units?: string;
  note: string;
}): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const chosen = outcome.parse(input.outcome);
    let unitsRefunded: number | undefined;
    if (chosen === "REFUND_UNITS") {
      const text = (input.units ?? "").trim();
      if (!/^\d{1,7}$/.test(text)) throw new ValidationError("Invalid units", "UNITS_RANGE");
      unitsRefunded = Number(text);
    }
    await resolveDispute(actor, id.parse(input.disputeId), { outcome: chosen, unitsRefunded, note: String(input.note ?? "") });
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${id.parse(input.orderId)}`);
    return { ok: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, code: "INVALID_DECISION" };
    return toActionResult(error);
  }
}

