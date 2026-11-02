"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { UnauthenticatedError, ValidationError } from "@/lib/errors";
import { getOwnedMembership } from "@/modules/identity/service";

const input = z.string().min(1).max(128);

export async function setActiveRole(
  membershipId: string,
): Promise<ActionResult> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthenticatedError();

    const parsed = input.safeParse(membershipId);
    if (!parsed.success) throw new ValidationError("Invalid membership id");

    const membership = await getOwnedMembership(session.user.id, parsed.data);

    const cookieStore = await cookies();
    cookieStore.set("activeMembershipId", membership.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: env.APP_ENV !== "local",
    });
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}
