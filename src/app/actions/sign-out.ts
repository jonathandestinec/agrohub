"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { toActionResult } from "@/lib/action-result";
import { auth } from "@/lib/auth";

// A form action, so a tap that lands before hydration still signs out. On failure the
// user stays where they are, signed in; the error is logged by toActionResult.
export async function signOut(): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.delete("activeMembershipId");
    await auth.api.signOut({ headers: await headers() });
  } catch (error) {
    toActionResult(error);
    return;
  }
  redirect("/sign-in");
}
