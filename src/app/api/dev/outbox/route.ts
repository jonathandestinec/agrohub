import { connection } from "next/server";
import { fakeOutbox } from "@/lib/email";
import { env } from "@/lib/env";

// Dev-only: lets local e2e tests read the fake outbox. 404 everywhere else.
// Two independent guards: APP_ENV defaults to "local" when unset, so a deployment
// that forgets it must still refuse here. Every production build and runtime has
// NODE_ENV=production; `next dev` (and the Playwright webServer) does not.
export async function GET(): Promise<Response> {
  if (env.APP_ENV !== "local" || process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }
  // The outbox changes per request, so it must never be prerendered.
  await connection();
  return Response.json(fakeOutbox.sent, { headers: { "Cache-Control": "no-store" } });
}
