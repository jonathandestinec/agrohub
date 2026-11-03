"use server";

import { revalidatePath } from "next/cache";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { toKobo } from "@/lib/money";
import { recordPrice } from "@/modules/board/service";
import {
  approveCatalogRequest,
  declineCatalogRequest,
  createCrop,
  createUnit,
  renameCrop,
  renameUnit,
  setCropActive,
  setUnitActive,
} from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { requireActor } from "@/modules/identity/session";

type Kind = "crop" | "unit";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The actor always comes from the session, never from the client.
async function run(work: (actor: Actor) => Promise<unknown>): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await work(actor);
    revalidatePath("/board");
    revalidatePath("/board/crops");
    revalidatePath("/prices");
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function addCatalogItemAction(input: { kind: Kind; name: string }): Promise<ActionResult> {
  return run((actor) =>
    input?.kind === "unit"
      ? createUnit(actor, { name: text(input.name) })
      : createCrop(actor, { name: text(input?.name) }),
  );
}

export async function renameCatalogItemAction(input: {
  kind: Kind;
  id: string;
  name: string;
}): Promise<ActionResult> {
  return run((actor) =>
    input?.kind === "unit"
      ? renameUnit(actor, text(input.id), { name: text(input.name) })
      : renameCrop(actor, text(input?.id), { name: text(input?.name) }),
  );
}

export async function setCatalogItemActiveAction(input: {
  kind: Kind;
  id: string;
  active: boolean;
}): Promise<ActionResult> {
  const active = input?.active === true;
  return run((actor) =>
    input?.kind === "unit"
      ? setUnitActive(actor, text(input.id), active)
      : setCropActive(actor, text(input?.id), active),
  );
}

// price is the naira amount as typed ("52000", "52,000.50"); commas and spaces are ignored.
export async function recordPriceAction(input: {
  cropId: string;
  unitId: string;
  market: string;
  weekOf: string;
  price: string;
}): Promise<ActionResult> {
  return run((actor) => {
    let priceKobo: number;
    try {
      priceKobo = toKobo(text(input?.price).replace(/[\s,]/g, ""));
    } catch {
      throw new ValidationError("Invalid price", "INVALID_PRICE");
    }
    return recordPrice(actor, {
      cropId: text(input?.cropId),
      unitId: text(input?.unitId),
      market: text(input?.market),
      weekOf: text(input?.weekOf),
      priceKobo,
    });
  });
}

export async function approveCatalogRequestAction(input: { id: string; name: string }): Promise<ActionResult> {
  return run((actor) => approveCatalogRequest(actor, text(input?.id), { name: text(input?.name) }));
}

export async function declineCatalogRequestAction(input: { id: string; reason: string }): Promise<ActionResult> {
  return run((actor) => declineCatalogRequest(actor, text(input?.id), { reason: text(input?.reason) }));
}
