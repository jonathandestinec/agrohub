"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { authClient } from "@/lib/auth-client";
import { safeNext, withNext } from "@/lib/safe-next";

const ERROR_KEYS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "invalid",
  EMAIL_NOT_VERIFIED: "unverified",
};

// next is already checked by the page; it is checked again here because it is URL data.
export function SignInForm({ next }: { next: string }) {
  const returnTo = safeNext(next);
  const t = useTranslations("auth.signIn");
  const fields = useTranslations("auth.fields");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { data, error: failure } = await authClient.signIn.email({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });
    if (failure) {
      setPending(false);
      setError(t(ERROR_KEYS[failure.code ?? ""] ?? "error"));
      return;
    }
    // A user with two-factor gets no session yet: the code is entered on /two-factor.
    router.replace(data && "twoFactorRedirect" in data ? "/two-factor" : returnTo);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field
        id="email"
        name="email"
        type="email"
        label={fields("email")}
        autoComplete="email"
        required
      />
      <Field
        id="password"
        name="password"
        type="password"
        label={fields("password")}
        autoComplete="current-password"
        required
      />
      <FormError message={error} />
      <SubmitButton pending={pending} label={t("submit")} pendingLabel={t("submitting")} />
      <p className="body-6 text-ink-soft">
        {t("noAccount")}{" "}
        <Link href={withNext("/sign-up", returnTo)} className="underline underline-offset-2">
          {t("signUpLink")}
        </Link>
      </p>
    </form>
  );
}
