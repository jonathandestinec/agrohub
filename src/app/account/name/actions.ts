"use server";

import { revalidatePath } from "next/cache";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { UnauthenticatedError } from "@/lib/errors";
import { currentUser } from "@/modules/identity/session";
import {
  requestOwnNameChange,
  withdrawOwnNameChange,
  type OwnNameChange,
} from "@/modules/name-changes/service";
import { nameChangeFromForm } from "./form-data";

function revalidateNamePages(): void {
  revalidatePath("/account/name");
  revalidatePath("/admin/names");
}

// Self-scoped: the user always comes from the session, never from the form.
async function signedInUser(): Promise<{ userId: string }> {
  const user = await currentUser();
  if (!user) throw new UnauthenticatedError();
  return { userId: user.userId };
}

export async function requestOwnNameChangeAction(
  form: FormData,
): Promise<ActionResult<OwnNameChange>> {
  try {
    const user = await signedInUser();
    const { input, file } = await nameChangeFromForm(form);
    const request = await requestOwnNameChange(user, input, file);
    revalidateNamePages();
    return { ok: true, data: request };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function withdrawOwnNameChangeAction(input: {
  requestId: string;
}): Promise<ActionResult<OwnNameChange>> {
  try {
    const user = await signedInUser();
    const request = await withdrawOwnNameChange(user, String(input?.requestId ?? ""));
    revalidateNamePages();
    return { ok: true, data: request };
  } catch (error) {
    return toActionResult(error);
  }
}
