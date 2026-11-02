"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { signOut } from "@/app/actions/sign-out";

export function SignOutButton() {
  const t = useTranslations("header");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await signOut();
          if (result.ok) {
            router.replace("/sign-in");
            router.refresh();
          }
        })
      }
      className="min-h-11 rounded-md border border-border bg-bg px-3 text-base text-fg disabled:opacity-60"
    >
      {t("signOut")}
    </button>
  );
}
