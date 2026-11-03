"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { AuthCard, Field, FormError, SubmitButton } from "@/components/auth-ui";
import { OtpInput } from "@/components/otp-input";
import { authClient } from "@/lib/auth-client";
import { buttonClass } from "@/components/ui/button";

type Setup = { totpURI: string; secret: string; backupCodes: string[]; qrSrc: string };

// The QR code is drawn in the browser: the setup key never goes to a QR service.
// Always dark on white, whatever the theme, so every authenticator app can read it.
async function qrImage(uri: string): Promise<string> {
  const svg = await QRCode.toString(uri, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mustRestart, setMustRestart] = useState(false);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [copied, setCopied] = useState(false);
  const [refusals, setRefusals] = useState(0);

  async function startEnrolment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { data, error: failure } = await authClient.twoFactor.enable({
      password: String(form.get("password") ?? ""),
    });
    if (failure || data?.method !== "totp") {
      setPending(false);
      setError(t(failure?.code === "INVALID_PASSWORD" ? "wrongPassword" : "error"));
      return;
    }
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    // Without a QR code the setup key and link below still work.
    const qrSrc = await qrImage(data.totpURI).catch(() => "");
    setPending(false);
    setSetup({ totpURI: data.totpURI, secret, backupCodes: data.backupCodes, qrSrc });
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.twoFactor.verifyTotp({
      code: String(form.get("code") ?? ""),
    });
    if (failure) {
      setPending(false);
      const key = codeErrorKey(failure.code);
      setError(t(key));
      setRefusals((n) => n + 1);
      // The pending sign-in is gone: the user has to sign in again.
      setMustRestart(mode === "verify" && (key === "expired" || key === "tooManyAttempts"));
      return;
    }
    // A full load, not router.replace: the client router cache still holds the
    // pre-2FA redirects (an admin page that sent this user here would send them again).
    window.location.replace("/");
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
      <OtpInput
        id="code"
        name="code"
        label={fields("code")}
        invalid={error !== null}
        shakeKey={refusals}
      />
      <FormError message={error} />
      {mustRestart ? (
        <Link href="/sign-in" className="underline underline-offset-2">
          {t("signInAgain")}
        </Link>
      ) : null}
      <SubmitButton pending={pending} label={t("submit")} pendingLabel={t("submitting")} />
    </form>
  );

  if (mode === "verify") {
    return (
      <AuthCard title={t("verifyTitle")}>
        <p className="text-ink-soft">{t("verifyIntro")}</p>
        {codeForm}
      </AuthCard>
    );
  }

  if (!setup) {
    return (
      <AuthCard title={t("enrolTitle")}>
        <p className="text-ink-soft">{t("enrolIntro")}</p>
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
      <p className="text-ink-soft">{t("setupInstructions")}</p>
      {setup.qrSrc ? (
        <div className="flex justify-center rounded-inner bg-step p-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URI, nothing to optimise */}
          <img
            src={setup.qrSrc}
            alt={t("qrAlt")}
            width={208}
            height={208}
            className="size-52 rounded-tile bg-white p-3"
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-2 rounded-inner bg-step p-4">
        <p className="body-6 text-ink-soft">{t("manualIntro")}</p>
        <span className="title-4">{t("secretLabel")}</span>
        <code data-testid="totp-secret" className="break-all font-mono body-3">
          {setup.secret}
        </code>
        <button
          type="button"
          onClick={copySecret}
          className={buttonClass("step")}
        >
          {copied ? t("copied") : t("copy")}
        </button>
        <a href={setup.totpURI} className="break-all body-6 underline underline-offset-2">
          {t("uriLabel")}
        </a>
      </div>
      {setup.backupCodes.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="heading-6">{t("backupCodesTitle")}</h2>
          <p className="body-6 text-ink-soft">{t("backupCodesBody")}</p>
          <ul className="grid grid-cols-2 gap-1 font-mono body-6">
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
