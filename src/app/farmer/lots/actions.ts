"use server";

import { revalidatePath } from "next/cache";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { toKobo } from "@/lib/money";
import { submitLot } from "@/modules/catalog/service";
import { requireActor } from "@/modules/identity/session";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

// A whole number typed by a person, or NaN (which the service schema refuses).
function whole(form: FormData, name: string): number {
  const value = text(form, name);
  return /^\d{1,9}$/.test(value) ? Number(value) : Number.NaN;
}

function naira(form: FormData, name: string): number {
  try {
    return toKobo(text(form, name).replace(/,/g, ""));
  } catch {
    throw new ValidationError("Invalid price", "INVALID_PRICE");
  }
}

function revalidateLots(): void {
  revalidatePath("/farmer/lots");
  revalidatePath("/officer/lots");
  revalidatePath("/admin/lots");
  revalidatePath("/lots");
}

export async function submitLotAction(form: FormData): Promise<ActionResult<{ lotId: string }>> {
  try {
    const actor = await requireActor();
    const files = form.getAll("photos").filter((f): f is File => typeof f !== "string");
    const photos = await Promise.all(
      files.map(async (file) => ({ body: Buffer.from(await file.arrayBuffer()), contentType: file.type })),
    );
    const lot = await submitLot(
      actor,
      {
        cropId: text(form, "cropId"),
        unitId: text(form, "unitId"),
        quantity: whole(form, "quantity"),
        grade: text(form, "grade"),
        pickupState: text(form, "pickupState"),
        pickupLga: text(form, "pickupLga"),
        pickupNote: text(form, "pickupNote"),
        askKobo: naira(form, "ask"),
        floorKobo: naira(form, "floor"),
        note: text(form, "note"),
        availableUntil: text(form, "availableUntil"),
      },
      photos,
    );
    revalidateLots();
    return { ok: true, data: { lotId: lot.id } };
  } catch (error) {
    return toActionResult(error);
  }
}
