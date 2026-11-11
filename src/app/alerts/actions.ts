"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { requireActor } from "@/modules/identity/session";
import {
  countOwnUnread,
  latestOwnAlerts,
  markAllRead,
  markRead,
  type AlertSummary,
} from "@/modules/notifications/service";

// A form action (it works before the page's script loads): marks the alert read, then goes to
// the page it is about. An alert that is not the person's, or is gone, lands on the list.
export async function openAlertAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  let href = "/alerts";
  try {
    href = (await markRead(actor, String(formData.get("id") ?? ""))).href;
  } catch (error) {
    if (!(error instanceof NotFoundError) && !(error instanceof ForbiddenError)) throw error;
  }
  // The header's count is rendered by the layout, which must render again to show it.
  revalidatePath("/", "layout");
  redirect(href);
}

export async function markAllAlertsReadAction(): Promise<ActionResult<AlertSummary>> {
  try {
    const actor = await requireActor();
    await markAllRead(actor);
    revalidatePath("/", "layout");
    const [unread, alerts] = await Promise.all([countOwnUnread(actor), latestOwnAlerts(actor)]);
    return { ok: true, data: { unread, alerts } };
  } catch (error) {
    return toActionResult(error);
  }
}
