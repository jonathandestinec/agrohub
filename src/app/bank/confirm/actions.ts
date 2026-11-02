"use server";

import { toActionResult, type ActionResult } from "@/lib/action-result";
import { confirmBankChange } from "@/modules/banking/service";

// Works signed out: the single-use token from the email is the proof.
export async function confirmBankChangeAction(
  form: FormData,
): Promise<ActionResult<{ effectiveAt: string }>> {
  try {
    const token = form.get("token");
    const { effectiveAt } = await confirmBankChange(typeof token === "string" ? token : "");
    return { ok: true, data: { effectiveAt: effectiveAt.toISOString() } };
  } catch (error) {
    return toActionResult(error);
  }
}
