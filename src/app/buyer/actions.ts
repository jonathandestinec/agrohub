"use server";

import { toActionResult, type ActionResult } from "@/lib/action-result";
import { UnauthenticatedError } from "@/lib/errors";
import { setActiveRole } from "@/app/actions/active-role";
import { becomeBuyer } from "@/modules/identity/service";
import { currentUser } from "@/modules/identity/session";

// Grants the signed-in user a buyer membership and makes it their active role.
export async function becomeBuyerAction(): Promise<ActionResult<{ membershipId: string }>> {
  try {
    const user = await currentUser();
    if (!user) throw new UnauthenticatedError();
    const { membershipId } = await becomeBuyer(user);
    const switched = await setActiveRole(membershipId);
    if (!switched.ok) return switched;
    return { ok: true, data: { membershipId } };
  } catch (error) {
    return toActionResult(error);
  }
}
