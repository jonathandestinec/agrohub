"use server";

import { revalidatePath } from "next/cache";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { UnauthenticatedError } from "@/lib/errors";
import { setOwnFarmerBankAccount } from "@/modules/banking/service";
import { splitCrops } from "@/modules/farmers/schema";
import { joinViaLink, leaveCooperative } from "@/modules/farmers/service";
import { currentUser, requireActor } from "@/modules/identity/session";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function signedInUser(): Promise<{ userId: string }> {
  const user = await currentUser();
  if (!user) throw new UnauthenticatedError();
  return { userId: user.userId };
}

// A PENDING farmer has no Actor, so these use the signed-in user; the services are
// self-scoped to that user.
export async function joinCooperativeAction(
  token: string,
  form: FormData,
): Promise<ActionResult> {
  try {
    const user = await signedInUser();
    await joinViaLink(
      user,
      typeof token === "string" ? token : "",
      {
        farmSizeHectares: text(form, "farmSizeHectares"),
        crops: splitCrops(text(form, "crops")),
        state: text(form, "state"),
        lga: text(form, "lga"),
      },
      new Date(),
    );
    revalidatePath("/farmer");
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}

// The account number goes straight to the service; it is never logged or returned.
export async function setFarmerBankAccountAction(
  form: FormData,
): Promise<ActionResult<{ accountName: string; pending: boolean }>> {
  try {
    const user = await signedInUser();
    const result = await setOwnFarmerBankAccount(user, {
      accountNumber: text(form, "accountNumber").replace(/\s/g, ""),
      bankCode: text(form, "bankCode"),
    });
    revalidatePath("/farmer");
    return { ok: true, data: result };
  } catch (error) {
    return toActionResult(error);
  }
}

// Self-scoped: the service acts only on the signed-in farmer's own ACTIVE membership.
export async function leaveCooperativeAction(): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await leaveCooperative(actor);
    revalidatePath("/farmer");
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}
