"use server";

import { revalidatePath } from "next/cache";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import {
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";
import {
  createCooperative,
  uploadDocument,
} from "@/modules/cooperatives/service";
import {
  inviteFarmerByEmail,
  regenerateInviteLink,
} from "@/modules/cooperatives/invites";
import { DOCUMENT_KINDS } from "@/modules/cooperatives/schema";
import { setCooperativeBankAccount } from "@/modules/banking/service";
import { currentUser, requireActor } from "@/modules/identity/session";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function createCooperativeAction(
  form: FormData,
): Promise<ActionResult> {
  try {
    const user = await currentUser();
    if (!user) throw new UnauthenticatedError();
    const expiry = new Date(`${text(form, "certificateExpiresAt")}T00:00:00Z`);
    if (Number.isNaN(expiry.getTime())) {
      throw new ValidationError("Invalid certificate expiry date");
    }
    await createCooperative(
      { userId: user.userId },
      {
        name: text(form, "name"),
        registrationNumber: text(form, "registrationNumber"),
        state: text(form, "state"),
        lga: text(form, "lga"),
        certificateExpiresAt: expiry,
      },
    );
    revalidatePath("/officer/onboarding");
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function uploadDocumentAction(
  form: FormData,
): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const kind = DOCUMENT_KINDS.find((k) => k === text(form, "kind"));
    if (!kind) throw new ValidationError("Unknown document kind", "INVALID_KIND");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new ValidationError("No file", "NO_FILE");
    }
    if (actor.cooperativeId === null) throw new ForbiddenError();
    await uploadDocument(actor, actor.cooperativeId, {
      kind,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
    });
    revalidatePath("/officer/onboarding");
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}

// The account number goes straight to the service; it is never logged or returned.
export async function setBankAccountAction(
  form: FormData,
): Promise<ActionResult<{ accountName: string; pending: boolean }>> {
  try {
    const actor = await requireActor();
    if (actor.cooperativeId === null) throw new ForbiddenError();
    const result = await setCooperativeBankAccount(actor, actor.cooperativeId, {
      accountNumber: text(form, "accountNumber").replace(/\s/g, ""),
      bankCode: text(form, "bankCode"),
    });
    revalidatePath("/officer/onboarding");
    return { ok: true, data: result };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function regenerateInviteLinkAction(): Promise<
  ActionResult<{ url: string }>
> {
  try {
    const actor = await requireActor();
    if (actor.cooperativeId === null) throw new ForbiddenError();
    const result = await regenerateInviteLink(actor, actor.cooperativeId);
    revalidatePath("/officer/invites");
    return { ok: true, data: result };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function inviteFarmerByEmailAction(
  form: FormData,
): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    if (actor.cooperativeId === null) throw new ForbiddenError();
    await inviteFarmerByEmail(actor, actor.cooperativeId, text(form, "email"));
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}
