import { safeNext } from "@/lib/safe-next";

// Better Auth 1.7 has no config-level emailVerification.callbackURL (it comes from each
// request body), so the server pins it: every verification link lands on /verified.
export const VERIFIED_CALLBACK_PATH = "/verified";

const PARSE_BASE = "http://callback.invalid";

// The only thing kept from the client's callbackURL is a `next` on a relative /verified
// callback (sign-up started from a page with ?next=). It is checked with safeNext, and
// /verified checks it again when it reads it. Anything else becomes plain /verified.
export function withVerifiedCallback(url: string): string {
  const link = new URL(url);
  let next = "/";
  const requested = link.searchParams.get("callbackURL");
  if (requested !== null && requested.startsWith("/")) {
    try {
      const callback = new URL(requested, PARSE_BASE);
      if (callback.origin === PARSE_BASE && callback.pathname === VERIFIED_CALLBACK_PATH) {
        next = safeNext(callback.searchParams.get("next"));
      }
    } catch {
      next = "/";
    }
  }
  link.searchParams.set(
    "callbackURL",
    next === "/" ? VERIFIED_CALLBACK_PATH : `${VERIFIED_CALLBACK_PATH}?next=${encodeURIComponent(next)}`,
  );
  return link.toString();
}
