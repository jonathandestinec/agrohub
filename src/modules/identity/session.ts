import { cookies, headers } from "next/headers";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { UnauthenticatedError } from "@/lib/errors";
import { pickActiveMembership } from "./active-role";
import { membershipGeneration } from "./cache-generation";
import type { Actor } from "./policies";
import { requireSecondFactor } from "./second-factor";
import { listMemberships } from "./service";

// One lookup per request. react cache() lasts for a single server render or route-handler request
// and is dropped afterwards, so nothing here is shared across requests. The key is the request's
// serialized cookies (a read of cookies() sees writes made earlier in the same request), so a
// changed session, a role switch or a sign-out gets a different key and is looked up again, and
// two users can never share an entry. Do not move this to 'use cache', which spans requests.
// The key arguments are never read; they only make cache() pick a different entry.
// Memberships also key on the generation, which a membership write bumps (cache-generation.ts).
/* eslint-disable @typescript-eslint/no-unused-vars */
const sessionFor = cache(async (_cookieKey: string) =>
  auth.api.getSession({ headers: await headers() }),
);
const membershipsFor = cache(async (userId: string, _cookieKey: string, _generation: number) =>
  listMemberships(userId),
);
/* eslint-enable @typescript-eslint/no-unused-vars */

// The Better Auth session for this request, or null. Use this, not auth.api.getSession.
export async function getSession() {
  return sessionFor((await cookies()).toString());
}

// The user's ACTIVE memberships for this request.
export async function getMemberships(userId: string) {
  return membershipsFor(userId, (await cookies()).toString(), membershipGeneration());
}

// Resolves the signed-in user, their active ACTIVE membership and 2FA state into an
// Actor. Returns null with no session or no active membership; throws ForbiddenError
// ("2FA_REQUIRED") for an ADMIN or BOARD_ADMIN without two-factor.
export async function getActor(): Promise<Actor | null> {
  const session = await getSession();
  if (!session) return null;
  const memberships = await getMemberships(session.user.id);
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
  const session = await getSession();
  if (!session) return null;
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    twoFactorEnabled: session.user.twoFactorEnabled === true,
  };
}
