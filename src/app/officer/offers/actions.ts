"use server";

import { revalidatePath } from "next/cache";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { toKobo } from "@/lib/money";
import { requireActor } from "@/modules/identity/session";
import { respondToOffer } from "@/modules/marketplace/service";

const DECISIONS = ["ACCEPT", "REJECT", "COUNTER"] as const;

// counter is naira per unit as typed; it is read only for COUNTER.
export async function respondToOfferAction(input: {
  offerId: string;
  decision: string;
  counter: string;
  message: string;
}): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const decision = DECISIONS.find((d) => d === input.decision);
    if (!decision || typeof input.offerId !== "string" || input.offerId.length > 64) {
      throw new ValidationError("Invalid response", "INVALID_OFFER");
    }
    let counterKobo: number | undefined;
    if (decision === "COUNTER") {
      try {
        counterKobo = toKobo(input.counter.trim().replace(/,/g, ""));
      } catch {
        throw new ValidationError("Invalid price", "INVALID_PRICE");
      }
    }
    await respondToOffer(actor, input.offerId, {
      decision,
      counterKobo,
      message: input.message.trim() ? input.message : undefined,
    });
    revalidatePath("/officer/offers");
    revalidatePath(`/officer/offers/${input.offerId}`);
    revalidatePath("/farmer/lots");
    revalidatePath("/buyer");

    revalidatePath("/buyer/offers");
    revalidatePath("/messages");
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}
