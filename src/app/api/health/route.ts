import { pingDatabase } from "@/lib/db";
import { env } from "@/lib/env";

// The database query makes this run at request time under cacheComponents,
// so it is never prerendered at build.
export async function GET(): Promise<Response> {
  const up = await pingDatabase();
  return Response.json(
    { status: "ok", env: env.APP_ENV, db: up ? "up" : "down" },
    { status: up ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
