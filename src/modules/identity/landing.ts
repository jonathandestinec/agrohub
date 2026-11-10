import { safeNext } from "@/lib/safe-next";
import type { Role } from "./policies";

// Pure: where a person lands after signing in (or after the two-factor code). An explicit,
// safe `next` wins; "/" is the sign-in form's default and counts as none. Otherwise the page
// the active role works from. An officer whose cooperative is not VERIFIED yet starts at
// onboarding. With no active membership the home page stays.
export function landingPath(input: {
  next: string;
  role: Role | null;
  cooperativeVerified: boolean;
}): string {
  const next = safeNext(input.next);
  if (next !== "/") return next;
  switch (input.role) {
    case "ADMIN":
      return "/admin/orders";
    case "BOARD_ADMIN":
      return "/board";
    case "OFFICER":
      return input.cooperativeVerified ? "/officer/orders" : "/officer/onboarding";
    case "FARMER":
      return "/farmer";
    case "BUYER":
      return "/lots";
    default:
      return "/";
  }
}
