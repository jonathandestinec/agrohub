"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { authClient } from "@/lib/auth-client";

// The server answers the same way for known and unknown addresses, and so does this page:
// it never shows whether an account exists.
export function ForgotPasswordForm() {
  const t = useTranslations("auth.forgot");
  const fields = useTranslations("auth.fields");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.requestPasswordReset({
      email,
      // A fixed in-app path, never taken from the URL: the emailed link lands here with the token.
      redirectTo: "/reset-password",
    });
    setPending(false);
    if (failure) {
      setError(t("error"));
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <section aria-live="polite" className="flex flex-col gap-2">
        <h2 className="heading-6">{t("sentTitle")}</h2>
        <p className="text-ink-soft">{t("sentBody", { email: sentTo })}</p>
        <Link href="/sign-in" className="underline underline-offset-2">
          {t("back")}
        </Link>
      </section>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field id="email" name="email" type="email" label={fields("email")} autoComplete="email" required />
      <FormError message={error} />
      <SubmitButton pending={pending} label={t("submit")} pendingLabel={t("submitting")} waitForHydration />
      <Link href="/sign-in" className="body-6 text-ink-soft underline underline-offset-2">
        {t("back")}
      </Link>
    </form>
  );
}
