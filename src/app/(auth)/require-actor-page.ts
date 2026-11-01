import { redirect } from "next/navigation";
import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "@/modules/identity/policies";
import { getActor } from "@/modules/identity/session";

// For pages that need an Actor: signed out (or no active membership) goes to /sign-in,
// and an ADMIN or BOARD_ADMIN without two-factor goes to /two-factor to enrol.
export async function requireActorForPage(): Promise<Actor> {
  let actor: Actor | null;
  try {
    actor = await getActor();
  } catch (error) {
    if (error instanceof ForbiddenError && error.code === "2FA_REQUIRED") {
      redirect("/two-factor");
    }
    throw error;
  }
  if (!actor) redirect("/sign-in");
  return actor;
}
