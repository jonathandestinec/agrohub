"use server";

import { revalidatePath } from "next/cache";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import {
  reinstateCooperative,
  rejectCooperative,
  suspendCooperative,
  verifyCooperative,
} from "@/modules/cooperatives/service";
import type { Actor } from "@/modules/identity/policies";
import { percentToBps } from "@/lib/money";
import { updatePlatformSettings } from "@/modules/settings/service";
import { requireActor } from "@/modules/identity/session";

type ReviewInput = { cooperativeId: string; reason?: string };

function cooperativeIdOf(input: ReviewInput): string {
  if (typeof input?.cooperativeId !== "string" || input.cooperativeId === "") {
    throw new ValidationError("Missing cooperative");
  }
  return input.cooperativeId;
}

function reasonOf(input: ReviewInput): string {
  return typeof input.reason === "string" ? input.reason : "";
}

// The actor always comes from the session, never from the client.
async function run(
  input: ReviewInput,
  work: (actor: Actor, id: string) => Promise<unknown>,
): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const id = cooperativeIdOf(input);
    await work(actor, id);
    revalidatePath("/admin/cooperatives");
    revalidatePath(`/admin/cooperatives/${id}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function verifyCooperativeAction(
  input: ReviewInput,
): Promise<ActionResult> {
  return run(input, (actor, id) => verifyCooperative(actor, id));
}

export async function rejectCooperativeAction(
  input: ReviewInput,
): Promise<ActionResult> {
  return run(input, (actor, id) =>
    rejectCooperative(actor, id, reasonOf(input)),
  );
}

export async function suspendCooperativeAction(
  input: ReviewInput,
): Promise<ActionResult> {
  return run(input, (actor, id) =>
    suspendCooperative(actor, id, reasonOf(input)),
  );
}

export async function reinstateCooperativeAction(
  input: ReviewInput,
): Promise<ActionResult> {
  return run(input, (actor, id) => reinstateCooperative(actor, id));
}

type SettingsInput = { platformFee: string; maxCooperativeCut: string; priceDeviation: string };

// Percentages arrive as typed ("3", "2.5"); a malformed one is INVALID_SETTING.
export async function updateSettingsAction(input: SettingsInput): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    let parsed;
    try {
      parsed = {
        platformFeeBps: percentToBps(String(input?.platformFee ?? "").trim()),
        maxCooperativeCutBps: percentToBps(String(input?.maxCooperativeCut ?? "").trim()),
        priceDeviationBps: percentToBps(String(input?.priceDeviation ?? "").trim()),
      };
    } catch {
      throw new ValidationError("Invalid setting", "INVALID_SETTING");
    }
    await updatePlatformSettings(actor, parsed);
    revalidatePath("/admin/settings");
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}
