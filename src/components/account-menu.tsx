"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { signOut } from "@/app/actions/sign-out";
import { Menu, MENU_ITEM } from "@/components/ui/menu";
import { firstName, initials } from "./account-label";

// A form, not an onClick: React replays a submit made before hydration (and without
// JavaScript the browser posts it), so an early tap is never lost.
function SignOutForm({ className }: { className: string }) {
  return (
    <form action={signOut} className="w-full">
      <SignOutSubmit className={className} />
    </form>
  );
}

function SignOutSubmit({ className }: { className: string }) {
  const t = useTranslations("header");
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${className} disabled:opacity-50`}>
      {t("signOut")}
    </button>
  );
}

// Who is signed in, always in view: first name and the role in use (initials on narrow
// screens), opening a dropdown with the profile page and sign out. It stays in the bar at
// every width, beside the phone menu's toggle.
export function AccountMenu({ name, roleLabel }: { name: string; roleLabel: string | null }) {
  const t = useTranslations("header");
  const spoken = roleLabel ? `${name}, ${roleLabel}` : name;

  return (
    <Menu
      align="end"
      buttonLabel={`${t("accountMenu")}: ${spoken}`}
      buttonClassName="press flex min-h-11 items-center gap-2 rounded-full bg-step px-4 title-4 hover:bg-step-deep"
      button={
        <span className="flex flex-col items-start leading-tight">
          <span className="sm:hidden" aria-hidden="true">
            {initials(name)}
          </span>
          <span className="hidden sm:inline" aria-hidden="true">
            {firstName(name)}
          </span>
          {roleLabel ? (
            <span className="hidden max-w-36 truncate caption-4 text-ink-soft lg:block" aria-hidden="true">
              {roleLabel}
            </span>
          ) : null}
        </span>
      }
    >
      <Link href="/account" className={MENU_ITEM}>
        {t("profile")}
      </Link>
      <SignOutForm className={MENU_ITEM} />
    </Menu>
  );
}
