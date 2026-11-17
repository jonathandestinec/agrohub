"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { buttonClass } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("auth.reset");
  const fields = useTranslations("auth.fields");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newPassword = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.resetPassword({ newPassword, token });
    setPending(false);
    if (failure) {
      if (failure.code === "INVALID_TOKEN") setExpired(true);
      else if (failure.code === "PASSWORD_TOO_SHORT") setError(t("tooShort"));
      else setError(t("error"));
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <section aria-live="polite" className="flex flex-col gap-3">
        <h2 className="heading-6">{t("doneTitle")}</h2>
        <p className="text-ink-soft">{t("doneBody")}</p>
        <Link href="/sign-in" className={`${buttonClass("ink")} w-full`}>
          {t("signIn")}
        </Link>
      </section>
    );
  }

  if (expired) {
    return (
      <section aria-live="polite" className="flex flex-col gap-3">
        <h2 className="heading-6">{t("invalidTitle")}</h2>
        <p className="text-ink-soft">{t("invalidBody")}</p>
        <Link href="/forgot-password" className={`${buttonClass("ink")} w-full`}>
          {t("requestNew")}
        </Link>
      </section>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field
        id="password"
        name="password"
        type="password"
        label={fields("newPassword")}
        autoComplete="new-password"
        minLength={8}
        required
      />
      <FormError message={error} />
      <SubmitButton pending={pending} label={t("submit")} pendingLabel={t("submitting")} waitForHydration />
    </form>
  );
}
