"use client";

import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { signOut } from "@/app/actions/sign-out";
import { buttonClass } from "@/components/ui/button";

// A form, not an onClick: React replays a submit made before hydration (and without
// JavaScript the browser posts it), so an early tap is never lost.
export function SignOutButton() {
  return (
    <form action={signOut}>
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const t = useTranslations("header");
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("step")}>
      {t("signOut")}
    </button>
  );
}
