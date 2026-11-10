"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { signOut } from "@/app/actions/sign-out";
import { Menu, MENU_ITEM } from "@/components/ui/menu";
import { initials } from "./account-label";

// A form, not an onClick: React replays a submit made before hydration, so a tap made while the
// page is still loading is not lost. The menu itself needs script to open.
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

// Who is signed in: a round avatar in the bar showing the person's initials, opening a dropdown
// that starts with their full name and the role in use (plain text, not a menu item), then
// Profile and Sign out. It stays in the bar at every width, beside the phone menu's toggle.
export function AccountMenu({ name, roleLabel }: { name: string; roleLabel: string | null }) {
  const t = useTranslations("header");
  const spoken = roleLabel ? `${name}, ${roleLabel}` : name;

  return (
    <Menu
      align="end"
      hideChevron
      buttonLabel={`${t("accountMenu")}: ${spoken}`}
      buttonClassName="press flex size-11 shrink-0 items-center justify-center rounded-full bg-ink title-4 text-paper hover:bg-[#2a3028] aria-expanded:ring-2 aria-expanded:ring-lime aria-expanded:ring-offset-2 aria-expanded:ring-offset-paper"
      button={<span aria-hidden="true">{initials(name)}</span>}
    >
      <div className="flex max-w-72 flex-col px-3 pb-1 pt-2">
        <span className="truncate title-4" title={name}>
          {name}
        </span>
        {roleLabel ? <span className="truncate caption-4 text-ink-soft">{roleLabel}</span> : null}
      </div>
      <hr className="mx-2 my-1 border-ink/10" />
      <Link href="/account" className={MENU_ITEM}>
        {t("profile")}
      </Link>
      <SignOutForm className={MENU_ITEM} />
    </Menu>
  );
}
