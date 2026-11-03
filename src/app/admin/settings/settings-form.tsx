"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { formatPercent } from "@/lib/money";
import type { PlatformSettings } from "@/modules/settings/schema";
import { updateSettingsAction } from "../actions";

// "3%" → "3": the field holds the number only.
const asField = (bps: number) => formatPercent(bps).slice(0, -1);

export function SettingsForm({ settings }: { settings: PlatformSettings }) {
  const t = useTranslations("admin.settings");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await updateSettingsAction({
      platformFee: String(data.get("platformFee") ?? ""),
      maxCooperativeCut: String(data.get("maxCooperativeCut") ?? ""),
      priceDeviation: String(data.get("priceDeviation") ?? ""),
    });
    setPending(false);
    if (result.ok) setSaved(true);
    else setError(t(result.code === "INVALID_SETTING" ? "errors.INVALID_SETTING" : "errors.INTERNAL"));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field
        id="platformFee"
        name="platformFee"
        label={t("platformFee")}
        hint={t("platformFeeHint")}
        required
        inputMode="decimal"
        defaultValue={asField(settings.platformFeeBps)}
      />
      <Field
        id="maxCooperativeCut"
        name="maxCooperativeCut"
        label={t("maxCooperativeCut")}
        hint={t("maxCooperativeCutHint")}
        required
        inputMode="decimal"
        defaultValue={asField(settings.maxCooperativeCutBps)}
      />
      <Field
        id="priceDeviation"
        name="priceDeviation"
        label={t("priceDeviation")}
        hint={t("priceDeviationHint")}
        required
        inputMode="decimal"
        defaultValue={asField(settings.priceDeviationBps)}
      />
      <FormError message={error} />
      {saved ? (
        <p role="status" className="body-6 text-ink-soft">
          {t("saved")}
        </p>
      ) : null}
      <SubmitButton pending={pending} label={t("save")} pendingLabel={t("saving")} />
    </form>
  );
}
