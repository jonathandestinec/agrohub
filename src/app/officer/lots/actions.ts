"use server";

import { revalidatePath } from "next/cache";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { toKobo } from "@/lib/money";
import { approveLot, counterLot, rejectLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { requireActor } from "@/modules/identity/session";

// Officers and, for cooperatives with no other officer, admins screen through these.
type ScreeningInput = { lotId: string; minOrderQty?: string; reason?: string; counterAsk?: string; message?: string };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

async function run(input: ScreeningInput, work: (actor: Actor, lotId: string) => Promise<unknown>): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const lotId = text(input?.lotId);
    await work(actor, lotId);
    for (const path of ["/officer/lots", "/admin/lots", "/farmer/lots", "/lots"]) revalidatePath(path);
    revalidatePath(`/officer/lots/${lotId}`);
    revalidatePath(`/admin/lots/${lotId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function approveLotAction(input: ScreeningInput): Promise<ActionResult> {
  return run(input, (actor, lotId) => {
    const raw = text(input?.minOrderQty);
    return approveLot(actor, lotId, { minOrderQty: /^\d{1,7}$/.test(raw) ? Number(raw) : Number.NaN });
  });
}

export async function rejectLotAction(input: ScreeningInput): Promise<ActionResult> {
  return run(input, (actor, lotId) => rejectLot(actor, lotId, { reason: text(input?.reason) }));
}

export async function counterLotAction(input: ScreeningInput): Promise<ActionResult> {
  return run(input, (actor, lotId) => {
    let counterAskKobo: number;
    try {
      counterAskKobo = toKobo(text(input?.counterAsk).replace(/,/g, ""));
    } catch {
      throw new ValidationError("Invalid price", "INVALID_PRICE");
    }
    return counterLot(actor, lotId, { counterAskKobo, message: text(input?.message) });
  });
}
