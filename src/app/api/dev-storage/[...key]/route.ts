import { env } from "@/lib/env";
import { fakeStorage, verifyDevStorage } from "@/lib/storage";

// Dev-only: serves fake-storage objects behind signed links. 404 everywhere else.
// Same two independent guards as /api/dev/outbox.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  if (env.APP_ENV !== "local" || process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }
  const segments = (await params).key;
  const key = segments.join("/");
  if (key.includes("..") || key.startsWith("/") || segments.some((s) => s === "")) {
    return new Response("Bad request", { status: 400 });
  }
  const url = new URL(request.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  if (
    !Number.isInteger(exp) ||
    exp < Math.floor(Date.now() / 1000) ||
    !/^[0-9a-f]*$/i.test(sig) ||
    !verifyDevStorage(key, exp, sig)
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  const object = fakeStorage.objects.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(object.body), {
    headers: { "Content-Type": object.contentType, "Cache-Control": "no-store" },
  });
}
