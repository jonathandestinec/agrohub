"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AuthCard, Field, FormError, SubmitButton } from "@/components/auth-ui";
import { authClient } from "@/lib/auth-client";

type Setup = { totpURI: string; secret: string; backupCodes: string[] };

function codeErrorKey(code: string | undefined): string {
  if (code === "INVALID_CODE") return "invalidCode";
  if (code === "INVALID_TWO_FACTOR_COOKIE") return "expired";
  if (code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE" || code === "ACCOUNT_TEMPORARILY_LOCKED") {
    return "tooManyAttempts";
  }
  return "error";
}

export function TwoFactorForm({ mode }: { mode: "enrol" | "verify" }) {
  const t = useTranslations("auth.twoFactor");
  const fields = useTranslations("auth.fields");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mustRestart, setMustRestart] = useState(false);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [copied, setCopied] = useState(false);

  async function startEnrolment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { data, error: failure } = await authClient.twoFactor.enable({
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (failure || data?.method !== "totp") {
      setError(t(failure?.code === "INVALID_PASSWORD" ? "wrongPassword" : "error"));
      return;
    }
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setSetup({ totpURI: data.totpURI, secret, backupCodes: data.backupCodes });
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.twoFactor.verifyTotp({
      code: String(form.get("code") ?? "").replace(/\s+/g, ""),
    });
    if (failure) {
      setPending(false);
      const key = codeErrorKey(failure.code);
      setError(t(key));
      // The pending sign-in is gone: the user has to sign in again.
      setMustRestart(mode === "verify" && (key === "expired" || key === "tooManyAttempts"));
      return;
    }
    router.replace("/");
    router.refresh();
  }

  async function copySecret() {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const codeForm = (
    <form onSubmit={verifyCode} className="flex flex-col gap-4">
      <Field
        id="code"
        name="code"
        label={fields("code")}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        required
      />
      <FormError message={error} />
      {mustRestart ? (
        <Link href="/sign-in" className="text-primary underline">
          {t("signInAgain")}
        </Link>
      ) : null}
      <SubmitButton pending={pending} label={t("submit")} pendingLabel={t("submitting")} />
    </form>
  );

  if (mode === "verify") {
    return (
      <AuthCard title={t("verifyTitle")}>
        <p className="text-muted">{t("verifyIntro")}</p>
        {codeForm}
      </AuthCard>
    );
  }

  if (!setup) {
    return (
      <AuthCard title={t("enrolTitle")}>
        <p className="text-muted">{t("enrolIntro")}</p>
        <form onSubmit={startEnrolment} className="flex flex-col gap-4">
          <Field
            id="password"
            name="password"
            type="password"
            label={fields("password")}
            autoComplete="current-password"
            required
          />
          <FormError message={error} />
          <SubmitButton pending={pending} label={t("start")} pendingLabel={t("starting")} />
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("enrolTitle")}>
      <p className="text-muted">{t("setupInstructions")}</p>
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
        <span className="text-sm font-medium">{t("secretLabel")}</span>
        <code data-testid="totp-secret" className="break-all font-mono text-base">
          {setup.secret}
        </code>
        <button
          type="button"
          onClick={copySecret}
          className="min-h-11 rounded-md border border-border bg-bg px-4 text-base"
        >
          {copied ? t("copied") : t("copy")}
        </button>
        <a href={setup.totpURI} className="break-all text-sm text-primary underline">
          {t("uriLabel")}
        </a>
      </div>
      {setup.backupCodes.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("backupCodesTitle")}</h2>
          <p className="text-sm text-muted">{t("backupCodesBody")}</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
            {setup.backupCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <p>{t("enrolConfirm")}</p>
      {codeForm}
    </AuthCard>
  );
}
