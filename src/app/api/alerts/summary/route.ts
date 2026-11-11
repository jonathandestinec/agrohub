import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import { getActor } from "@/modules/identity/session";
import { countOwnUnread, latestOwnAlerts } from "@/modules/notifications/service";

// The bell's data: the unread count and the five newest alerts for the signed-in person in the
// role they are using. Never cached. No `dynamic` export: the session read makes it dynamic.
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(): Promise<Response> {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE });
    const [unread, alerts] = await Promise.all([countOwnUnread(actor), latestOwnAlerts(actor)]);
    return NextResponse.json({ unread, alerts }, { headers: NO_STORE });
  } catch (error) {
    // An admin who has not set up two-factor yet has no working identity, so no bell.
    if (error instanceof ForbiddenError || error instanceof UnauthenticatedError) {
      return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE });
    }
    throw error;
  }
}
