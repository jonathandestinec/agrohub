"use server";

import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";
import { getOwnCooperative } from "@/modules/cooperatives/service";
import { pickActiveMembership } from "@/modules/identity/active-role";
import { landingPath } from "@/modules/identity/landing";
import { listMemberships } from "@/modules/identity/service";

// Where the browser goes once the person is signed in (after the password, or after the
// two-factor code). Decided here from the session and the active membership (the one the role
// switcher chose, else the first active one), never from anything the browser sends except
// `next`, which is checked. Any failure falls back to `next` itself.
export async function resolveLanding(next: string): Promise<string> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return safeNext(next);
    const memberships = await listMemberships(session.user.id);
    const cookieStore = await cookies();
    const active = pickActiveMembership(memberships, cookieStore.get("activeMembershipId")?.value);
    let cooperativeVerified = false;
    if (active?.role === "OFFICER") {
      const { cooperative } = await getOwnCooperative({
        userId: session.user.id,
        role: active.role,
        cooperativeId: active.cooperativeId,
        twoFactorEnabled: session.user.twoFactorEnabled === true,
      });
      cooperativeVerified = cooperative.status === "VERIFIED";
    }
    return landingPath({ next, role: active?.role ?? null, cooperativeVerified });
  } catch {
    return safeNext(next);
  }
}
