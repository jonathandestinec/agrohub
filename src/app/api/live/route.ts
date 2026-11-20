import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import { liveRequestSchema } from "@/lib/live/topics";
import { getActor } from "@/modules/identity/session";
import { readTopics } from "@/modules/live/service";

// Open pages ask here whether anything they show has changed. Never cached. No `dynamic` export:
// the session read makes it dynamic (the same as /api/alerts/summary).
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE });
    const body = await request.json().catch(() => null);
    const parsed = liveRequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ code: "INVALID" }, { status: 400, headers: NO_STORE });
    const topics = await readTopics(actor, parsed.data.topics);
    return NextResponse.json({ topics }, { headers: NO_STORE });
  } catch (error) {
    // An admin who has not set up two-factor yet has no working identity.
    if (error instanceof ForbiddenError || error instanceof UnauthenticatedError) {
      return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE });
    }
    throw error;
  }
}
