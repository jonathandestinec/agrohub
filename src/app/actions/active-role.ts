"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { getOwnedMembership } from "@/modules/identity/service";

const input = z.string().min(1).max(128);

export async function setActiveRole(membershipId: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new ForbiddenError("UNAUTHENTICATED");

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
}
