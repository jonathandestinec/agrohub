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
import { DOCUMENT_KINDS } from "@/modules/cooperatives/schema";
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
