import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import "@/lib/jobs"; // registers job definitions
import { getJob } from "@/lib/jobs/registry";
import { runOnce } from "@/lib/jobs/run-once";

function isAuthorized(header: string | null): boolean {
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const actual = Buffer.from(header ?? "");
  // timingSafeEqual throws on length mismatch, so guard first.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Vercel Cron issues GET requests.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ job: string }> },
): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job: name } = await params;
  const handler = getJob(name);
  if (!handler) {
    return Response.json({ error: "Unknown job" }, { status: 404 });
  }

  // One slot per UTC minute, e.g. 2026-11-01T10:05.
  const utcMinute = new Date().toISOString().slice(0, 16);
  try {
    const result = await runOnce(`${name}:${utcMinute}`, handler);
    return Response.json({ result });
  } catch {
    // Deliberately no error details in the body or logs: jobs may touch secrets.
    return Response.json({ error: "Job failed" }, { status: 500 });
  }
}
