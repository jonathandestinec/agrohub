import { redirect } from "next/navigation";
import { Suspense } from "react";
import { currentUser } from "@/modules/identity/session";
import { TwoFactorForm } from "./two-factor-form";

// Two modes: a signed-in user without two-factor enrols (sent here by requireActorForPage);
// a user mid sign-in (no session yet, only Better Auth's two-factor cookie) verifies a code.
export default function TwoFactorPage() {
  return (
    <Suspense fallback={null}>
      <TwoFactorStep />
    </Suspense>
  );
}

async function TwoFactorStep() {
  const user = await currentUser();
  if (user?.twoFactorEnabled) redirect("/");
  return <TwoFactorForm mode={user ? "enrol" : "verify"} />;
}
