"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { UnauthenticatedError, ValidationError } from "@/lib/errors";
import { toKobo } from "@/lib/money";
import { setActiveRole } from "@/app/actions/active-role";
import { becomeBuyer } from "@/modules/identity/service";
import { currentUser, requireActor } from "@/modules/identity/session";
import { makeOffer, respondToCounter, withdrawOffer } from "@/modules/marketplace/service";

const id = z.string().min(1).max(64);

function nairaToKobo(value: string): number {
  try {
    return toKobo(value.trim().replace(/,/g, ""));
  } catch {
    throw new ValidationError("Invalid price", "INVALID_PRICE");
  }
}

function revalidateOffers(offerId?: string): void {
  revalidatePath("/buyer");

  revalidatePath("/buyer/offers");
  if (offerId) revalidatePath(`/buyer/offers/${offerId}`);
  revalidatePath("/officer/offers");
  revalidatePath("/messages");
}

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

// price is naira per unit as typed ("40000", "40,000.50").
export async function makeOfferAction(input: {
  lotId: string;
  quantity: string;
  price: string;
  message: string;
}): Promise<ActionResult<{ offerId: string }>> {
  try {
    const actor = await requireActor();
    const lotId = id.safeParse(input.lotId);
    const quantity = /^\d{1,7}$/.test(input.quantity.trim()) ? Number(input.quantity.trim()) : Number.NaN;
    if (!lotId.success) throw new ValidationError("Invalid lot", "LOT_NOT_AVAILABLE");
    const offer = await makeOffer(actor, {
      lotId: lotId.data,
      quantity,
      offeredKobo: nairaToKobo(input.price),
      message: input.message.trim() ? input.message : undefined,
    });
    revalidateOffers(offer.id);
    return { ok: true, data: { offerId: offer.id } };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function respondToCounterAction(input: { offerId: string; accept: boolean }): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const offerId = id.parse(input.offerId);
    await respondToCounter(actor, offerId, input.accept === true);
    revalidateOffers(offerId);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function withdrawOfferAction(input: { offerId: string }): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const offerId = id.parse(input.offerId);
    await withdrawOffer(actor, offerId);
    revalidateOffers(offerId);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}
