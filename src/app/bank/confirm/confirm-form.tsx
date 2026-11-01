"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FormError, SubmitButton } from "@/components/auth-ui";
import { formatEffectiveAt } from "@/modules/banking/views";
import { confirmBankChangeAction } from "./actions";

export function ConfirmForm({ token }: { token: string }) {
  const t = useTranslations("bank.confirm");
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [effectiveAt, setEffectiveAt] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await confirmBankChangeAction(new FormData(event.currentTarget));
    setPending(false);
    if (!result.ok) {
      setError(result.code === "BANK_CHANGE_INVALID" ? t("invalid") : t("error"));
      return;
    }
    setEffectiveAt(result.data.effectiveAt);
  }

  if (effectiveAt) {
    return (
      <p
        role="status"
        className="rounded-md border border-border bg-surface px-3 py-3 text-base"
      >
        {t("done", { date: formatEffectiveAt(effectiveAt, locale) })}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <FormError message={error} />
      <SubmitButton pending={pending} label={t("confirm")} pendingLabel={t("confirming")} />
    </form>
  );
}
