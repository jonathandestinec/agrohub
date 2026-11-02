"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import {
  inviteFarmerByEmailAction,
  regenerateInviteLinkAction,
} from "../actions";
import { buttonClass } from "@/components/ui/button";

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
  `${buttonClass("step")} w-full`;

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
        <h2 className="heading-6">
          {t("linkHeading")}
        </h2>
        <label htmlFor="invite-link" className="title-4">
          {t("linkLabel")}
        </label>
        <input
          id="invite-link"
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-12 w-full rounded-input bg-step px-4 body-3 text-ink"
        />
        <button type="button" onClick={copy} className={`${buttonClass("ink")} w-full`}>
          {copyState === "copied" ? t("copied") : t("copy")}
        </button>
        {copyState === "failed" ? (
          <p role="alert" className="body-3">
            {t("copyFailed")}
          </p>
        ) : null}
        {regenerated ? (
          <p role="status" className="body-3">
            {t("regenerated")}
          </p>
        ) : null}
        <FormError message={linkError} />
        {confirming ? (
          <div
            role="group"
            aria-label={t("regenerate")}
            className="flex flex-col gap-3 rounded-inner bg-step p-4 md:p-6"
          >
            <p className="body-3">{t("regenerateWarning")}</p>
            <button
              type="button"
              onClick={regenerate}
              disabled={regenerating}
              className={`${buttonClass("ink")} w-full`}
            >
              {regenerating ? t("regenerating") : t("regenerateConfirm")}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={regenerating}
              className={`${buttonClass("paper")} w-full`}
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
        <h2 className="heading-6">
          {t("emailHeading")}
        </h2>
        <p className="body-6 text-ink-soft">{t("emailIntro")}</p>
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
            <p role="status" className="body-3">
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
