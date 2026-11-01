import { connection } from "next/server";
import { fakeOutbox } from "@/lib/email";
import { env } from "@/lib/env";

// Dev-only: lets local e2e tests read the fake outbox. 404 everywhere else.
export async function GET(): Promise<Response> {
  if (env.APP_ENV !== "local") {
    return new Response("Not found", { status: 404 });
  }
  // The outbox changes per request, so it must never be prerendered.
  await connection();
  return Response.json(fakeOutbox.sent, { headers: { "Cache-Control": "no-store" } });
}
