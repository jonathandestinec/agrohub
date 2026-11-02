"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import {
  inviteFarmerByEmailAction,
  regenerateInviteLinkAction,
} from "../actions";

const KNOWN_ERRORS = [
  "INVALID_EMAIL",
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "COOPERATIVE_NOT_FOUND",
] as const;

function errorKey(code: string): `errors.${(typeof KNOWN_ERRORS)[number] | "INTERNAL"}` {
  const known = KNOWN_ERRORS.find((k) => k === code);
  return `errors.${known ?? "INTERNAL"}`;
}

const secondaryButton =
  "min-h-11 w-full rounded-md border border-border bg-bg px-4 text-base font-semibold text-fg disabled:opacity-60";

export function InvitesPanel({ initialUrl }: { initialUrl: string }) {
  const t = useTranslations("officer.invites");
  const [url, setUrl] = useState(initialUrl);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [confirming, setConfirming] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerated, setRegenerated] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  async function regenerate() {
    setRegenerating(true);
    setLinkError(null);
    setRegenerated(false);
    const outcome = await regenerateInviteLinkAction();
    setRegenerating(false);
    setConfirming(false);
    if (!outcome.ok) {
      setLinkError(t(errorKey(outcome.code)));
      return;
    }
    setUrl(outcome.data.url);
    setCopyState("idle");
    setRegenerated(true);
  }

  async function sendEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSending(true);
    setSent(false);
    setEmailError(null);
    const outcome = await inviteFarmerByEmailAction(new FormData(form));
    setSending(false);
    if (!outcome.ok) {
      setEmailError(t(errorKey(outcome.code)));
      return;
    }
    form.reset();
    setSent(true);
  }

  return (
    <>
      <section className="flex flex-col gap-4">
        <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">
          {t("linkHeading")}
        </h2>
        <label htmlFor="invite-link" className="text-sm font-medium">
          {t("linkLabel")}
        </label>
        <input
          id="invite-link"
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-11 w-full rounded-md border border-border bg-bg px-3 text-base text-fg"
        />
        <button type="button" onClick={copy} className="min-h-11 w-full rounded-md bg-primary px-4 text-base font-semibold text-primary-fg">
          {copyState === "copied" ? t("copied") : t("copy")}
        </button>
        {copyState === "failed" ? (
          <p role="alert" className="text-base">
            {t("copyFailed")}
          </p>
        ) : null}
        {regenerated ? (
          <p role="status" className="text-base">
            {t("regenerated")}
          </p>
        ) : null}
        <FormError message={linkError} />
        {confirming ? (
          <div
            role="group"
            aria-label={t("regenerate")}
            className="flex flex-col gap-3 rounded-md border border-border bg-surface px-3 py-3"
          >
            <p className="text-base">{t("regenerateWarning")}</p>
            <button
              type="button"
              onClick={regenerate}
              disabled={regenerating}
              className="min-h-11 w-full rounded-md bg-primary px-4 text-base font-semibold text-primary-fg disabled:opacity-60"
            >
              {regenerating ? t("regenerating") : t("regenerateConfirm")}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={regenerating}
              className={secondaryButton}
            >
              {t("regenerateCancel")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setRegenerated(false);
              setConfirming(true);
            }}
            className={secondaryButton}
          >
            {t("regenerate")}
          </button>
        )}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">
          {t("emailHeading")}
        </h2>
        <p className="text-sm text-muted">{t("emailIntro")}</p>
        <form onSubmit={sendEmail} className="flex flex-col gap-4">
          <Field
            id="invite-email"
            name="email"
            type="email"
            label={t("emailLabel")}
            autoComplete="off"
            inputMode="email"
            maxLength={254}
            required
          />
          <FormError message={emailError} />
          {sent ? (
            <p role="status" className="text-base">
              {t("emailSent")}
            </p>
          ) : null}
          <SubmitButton
            pending={sending}
            label={t("emailSend")}
            pendingLabel={t("emailSending")}
          />
        </form>
      </section>
    </>
  );
}
