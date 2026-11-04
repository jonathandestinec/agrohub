"use server";

import { revalidatePath } from "next/cache";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { percentToBps } from "@/lib/money";
import {
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";
import {
  createCooperative,
  setCooperativeCut,
  updateCooperativeDetails,
  uploadDocument,
} from "@/modules/cooperatives/service";
import {
  inviteFarmerByEmail,
  regenerateInviteLink,
} from "@/modules/cooperatives/invites";
import { DOCUMENT_KINDS } from "@/modules/cooperatives/schema";
import {
  declineCatalogRequestAsOfficer,
  forwardCatalogRequest,
  matchCatalogRequest,
} from "@/modules/catalog/service";
import {
  previewCooperativeBankAccount,
  setCooperativeBankAccount,
  type AccountPreview,
} from "@/modules/banking/service";
import { approveFarmer, rejectFarmer, removeFarmer } from "@/modules/farmers/service";
import { currentUser, requireActor } from "@/modules/identity/session";
import {
  requestCooperativeRename,
  withdrawCooperativeRename,
  type OwnNameChange,
} from "@/modules/name-changes/service";
import { nameChangeFromForm } from "@/app/account/name/form-data";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

// A YYYY-MM-DD date input as UTC midnight; undefined when missing or not a date.
function dateField(form: FormData, name: string): Date | undefined {
  const raw = text(form, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
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
      // Required for the certificate; the service refuses a missing or past date.
      certificateExpiresAt:
        kind === "REGISTRATION_CERTIFICATE"
          ? dateField(form, "certificateExpiresAt")
          : undefined,
    });
    revalidatePath("/officer/onboarding");
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function updateCooperativeDetailsAction(
  form: FormData,
): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    if (actor.cooperativeId === null) throw new ForbiddenError();
    await updateCooperativeDetails(actor, actor.cooperativeId, {
      name: text(form, "name"),
      registrationNumber: text(form, "registrationNumber"),
      state: text(form, "state"),
      lga: text(form, "lga"),
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

// Server actions take only the membership id (and a reason): the cooperative is read from
// the membership row by the service, never from the client.
function membershipIdOf(input: { membershipId: string }): string {
  return typeof input?.membershipId === "string" ? input.membershipId : "";
}

function reasonOf(input: { reason?: string }): string {
  return typeof input?.reason === "string" ? input.reason : "";
}

export async function approveFarmerAction(input: {
  membershipId: string;
}): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await approveFarmer(actor, membershipIdOf(input));
    revalidatePath("/officer/farmers");
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function rejectFarmerAction(input: {
  membershipId: string;
  reason: string;
}): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await rejectFarmer(actor, membershipIdOf(input), reasonOf(input));
    revalidatePath("/officer/farmers");
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function removeFarmerAction(input: {
  membershipId: string;
  reason: string;
}): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await removeFarmer(actor, membershipIdOf(input), reasonOf(input));
    revalidatePath("/officer/farmers");
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}

// The cut arrives as a typed percentage ("2.5"); a malformed one is INVALID_CUT.
export async function setCooperativeCutAction(input: { cut: string }): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    if (actor.cooperativeId === null) throw new ForbiddenError();
    let cutBps: number;
    try {
      cutBps = percentToBps(String(input?.cut ?? "").trim());
    } catch {
      throw new ValidationError("Invalid cut", "INVALID_CUT");
    }
    await setCooperativeCut(actor, actor.cooperativeId, cutBps);
    revalidatePath("/officer/onboarding");
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}

type RequestDecision = { id: string; reason?: string; itemId?: string };

async function decideRequest(
  input: RequestDecision,
  work: (actor: Awaited<ReturnType<typeof requireActor>>, id: string) => Promise<void>,
): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await work(actor, typeof input?.id === "string" ? input.id : "");
    revalidatePath("/officer/farmers");
    revalidatePath("/farmer");
    revalidatePath("/board/crops");
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function forwardCatalogRequestAction(input: RequestDecision): Promise<ActionResult> {
  return decideRequest(input, (actor, id) => forwardCatalogRequest(actor, id));
}

export async function declineCatalogRequestAction(input: RequestDecision): Promise<ActionResult> {
  return decideRequest(input, (actor, id) =>
    declineCatalogRequestAsOfficer(actor, id, { reason: String(input?.reason ?? "") }),
  );
}

export async function matchCatalogRequestAction(input: RequestDecision): Promise<ActionResult> {
  return decideRequest(input, (actor, id) => matchCatalogRequest(actor, id, String(input?.itemId ?? "")));
}

// Live lookup while typing: the name the bank holds and whether it matches. Stores nothing.
export async function previewBankAccountAction(input: {
  bankCode: string;
  accountNumber: string;
}): Promise<ActionResult<AccountPreview>> {
  try {
    const actor = await requireActor();
    if (actor.cooperativeId === null) throw new ForbiddenError();
    const preview = await previewCooperativeBankAccount(actor, actor.cooperativeId, {
      accountNumber: String(input?.accountNumber ?? "").replace(/\s/g, ""),
      bankCode: String(input?.bankCode ?? ""),
    });
    return { ok: true, data: preview };
  } catch (error) {
    return toActionResult(error);
  }
}

function revalidateRename(): void {
  revalidatePath("/officer/onboarding");
  revalidatePath("/admin/names");
}

// The cooperative is always the actor's own, never one named by the form.
export async function requestCooperativeRenameAction(
  form: FormData,
): Promise<ActionResult<OwnNameChange>> {
  try {
    const actor = await requireActor();
    if (actor.cooperativeId === null) throw new ForbiddenError();
    const { input, file } = await nameChangeFromForm(form);
    const request = await requestCooperativeRename(actor, actor.cooperativeId, input, file);
    revalidateRename();
    return { ok: true, data: request };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function withdrawCooperativeRenameAction(input: {
  requestId: string;
}): Promise<ActionResult<OwnNameChange>> {
  try {
    const actor = await requireActor();
    if (actor.cooperativeId === null) throw new ForbiddenError();
    const request = await withdrawCooperativeRename(
      actor,
      actor.cooperativeId,
      String(input?.requestId ?? ""),
    );
    revalidateRename();
    return { ok: true, data: request };
  } catch (error) {
    return toActionResult(error);
  }
}
