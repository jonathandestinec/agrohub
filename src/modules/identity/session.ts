import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { UnauthenticatedError } from "@/lib/errors";
import { pickActiveMembership } from "./active-role";
import type { Actor } from "./policies";
import { requireSecondFactor } from "./second-factor";
import { listMemberships } from "./service";

// Resolves the signed-in user, their active ACTIVE membership and 2FA state into an
// Actor. Returns null with no session or no active membership; throws ForbiddenError
// ("2FA_REQUIRED") for an ADMIN or BOARD_ADMIN without two-factor.
export async function getActor(): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const memberships = await listMemberships(session.user.id);
  const cookieStore = await cookies();
  const active = pickActiveMembership(
    memberships,
    cookieStore.get("activeMembershipId")?.value,
  );
  if (!active) return null;
  const twoFactorEnabled = session.user.twoFactorEnabled === true;
  requireSecondFactor({ role: active.role, twoFactorVerified: twoFactorEnabled });
  return {
    userId: session.user.id,
    role: active.role,
    cooperativeId: active.cooperativeId,
    twoFactorEnabled,
  };
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

export async function currentUser(): Promise<{
  userId: string;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
} | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    twoFactorEnabled: session.user.twoFactorEnabled === true,
  };
}
