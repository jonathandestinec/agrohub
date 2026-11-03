"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { setCooperativeCutAction } from "../actions";
import { errorKey } from "./error-key";

// The cooperative's own cut as a percentage. New lots are quoted with it; lots already
// submitted keep the cut they were shown.
export function CutForm({ current }: { current: string }) {
  const t = useTranslations("officer.onboarding");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await setCooperativeCutAction({
      cut: String(new FormData(event.currentTarget).get("cut") ?? ""),
    });
    setPending(false);
    if (!result.ok) {
      setError(t(errorKey(result.code)));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field
        id="cut"
        name="cut"
        label={t("cut.label")}
        hint={t("cut.hint")}
        defaultValue={current}
        inputMode="decimal"
        required
      />
      <FormError message={error} />
      {saved ? (
        <p role="status" className="body-6 text-ink-soft">
          {t("cut.saved")}
        </p>
      ) : null}
      <SubmitButton pending={pending} label={t("cut.save")} pendingLabel={t("cut.saving")} />
    </form>
  );
}
