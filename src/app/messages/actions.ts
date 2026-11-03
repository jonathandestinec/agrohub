"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { requireActor } from "@/modules/identity/session";
import { openLotThread, postMessage } from "@/modules/messaging/service";

const id = z.string().min(1).max(64);

export async function postMessageAction(input: { threadId: string; body: string }): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const threadId = id.safeParse(input.threadId);
    if (!threadId.success || typeof input.body !== "string") throw new ValidationError("Invalid message", "MESSAGE_LENGTH");
    await postMessage(actor, threadId.data, input.body);
    revalidatePath("/messages");
    revalidatePath(`/messages/${threadId.data}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}

// Opens (or finds) the lot's thread for the signed-in buyer, farmer or officer.
export async function openLotThreadAction(input: { lotId: string }): Promise<ActionResult<{ threadId: string }>> {
  try {
    const actor = await requireActor();
    const lotId = id.safeParse(input.lotId);
    if (!lotId.success) throw new ValidationError("Invalid lot", "LOT_NOT_FOUND");
    return { ok: true, data: await openLotThread(actor, lotId.data) };
  } catch (error) {
    return toActionResult(error);
  }
}
