"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { authClient } from "@/lib/auth-client";
import { safeNext, withNext } from "@/lib/safe-next";

// Better Auth's client type has no `consent`; the server's user-create hook reads it from the body.
type SignUpBody = Parameters<typeof authClient.signUp.email>[0] & { consent: boolean };

const ERROR_KEYS: Record<string, string> = {
  USER_ALREADY_EXISTS: "emailTaken",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "emailTaken",
  PASSWORD_TOO_SHORT: "passwordTooShort",
  CONSENT_REQUIRED: "consentRequired",
};

// Sign-up ends at "check your email" (verification is required), so next is carried to
// the sign-in link here and through the emailed link to /verified; signing in returns to it.
export function SignUpForm({ next }: { next: string }) {
  const returnTo = safeNext(next);
  const t = useTranslations("auth.signUp");
  const fields = useTranslations("auth.fields");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    setPending(true);
    setError(null);
    const body: SignUpBody = {
      name: String(form.get("name") ?? "").trim(),
      email,
      password: String(form.get("password") ?? ""),
      phone: String(form.get("phone") ?? "").trim(),
      // The server stamps consentAcceptedAt; it refuses sign-up without this flag.
      consent: form.get("consent") === "on",
      // The server pins verification links to /verified, keeping only a checked next
      // (src/lib/verified-callback.ts), so the verified page can carry it on to sign-in.
      callbackURL: withNext("/verified", returnTo),
    };
    const { error: failure } = await authClient.signUp.email(body);
    setPending(false);
    if (failure) {
      setError(t(ERROR_KEYS[failure.code ?? ""] ?? "error"));
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <section aria-live="polite" className="flex flex-col gap-2">
        <h2 className="heading-6">{t("checkEmailTitle")}</h2>
        <p className="text-ink-soft">{t("checkEmailBody", { email: sentTo })}</p>
        <Link href={withNext("/sign-in", returnTo)} className="underline underline-offset-2">
          {t("signInLink")}
        </Link>
      </section>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field id="name" name="name" label={fields("name")} autoComplete="name" required />
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
        hint={t("passwordHint")}
        autoComplete="new-password"
        minLength={8}
        required
      />
      <Field
        id="phone"
        name="phone"
        type="tel"
        label={fields("phone")}
        autoComplete="tel"
        inputMode="tel"
        required
      />
      <div className="flex items-start gap-3">
        <input
          id="consent"
          name="consent"
          type="checkbox"
          required
          className="mt-1 size-5 shrink-0 accent-forest"
        />
        <label htmlFor="consent" className="body-6">
          {t.rich("consent", {
            link: (chunks) => (
              <Link href="/privacy" className="underline underline-offset-2">
                {chunks}
              </Link>
            ),
          })}
        </label>
      </div>
      <FormError message={error} />
      <SubmitButton
        pending={pending}
        label={t("submit")}
        pendingLabel={t("submitting")}
        waitForHydration
      />
      <p className="body-6 text-ink-soft">
        {t("haveAccount")}{" "}
        <Link href={withNext("/sign-in", returnTo)} className="underline underline-offset-2">
          {t("signInLink")}
        </Link>
      </p>
    </form>
  );
}
