"use server";

import { cookies, headers } from "next/headers";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { auth } from "@/lib/auth";

export async function signOut(): Promise<ActionResult> {
  try {
    const cookieStore = await cookies();
    cookieStore.delete("activeMembershipId");
    await auth.api.signOut({ headers: await headers() });
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionResult(error);
  }
}
