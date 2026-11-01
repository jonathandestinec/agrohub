"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { updateCooperativeDetailsAction } from "../actions";
import { errorKey } from "./error-key";

type Details = { name: string; registrationNumber: string; state: string; lga: string };

// Shown only while the cooperative is PENDING: once verified, details are fixed.
export function EditCooperativeForm({
  details,
  states,
}: {
  details: Details;
  states: string[];
}) {
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
    const result = await updateCooperativeDetailsAction(new FormData(event.currentTarget));
    setPending(false);
    if (!result.ok) {
      setError(t(errorKey(result.code)));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <details className="rounded-lg border border-border bg-surface p-4">
      <summary className="flex min-h-11 cursor-pointer items-center text-base font-medium">
        {t("edit.heading")}
      </summary>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-4">
        <p className="text-sm text-muted">{t("edit.intro")}</p>
        <Field
          id="edit-name"
          name="name"
          label={t("fields.name")}
          defaultValue={details.name}
          required
        />
        <Field
          id="edit-registrationNumber"
          name="registrationNumber"
          label={t("fields.registrationNumber")}
          defaultValue={details.registrationNumber}
          required
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="edit-state" className="text-sm font-medium">
            {t("fields.state")}
          </label>
          <select
            id="edit-state"
            name="state"
            required
            defaultValue={details.state}
            className="min-h-11 w-full rounded-md border border-border bg-bg px-3 text-base text-fg"
          >
            {states.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>
        <Field
          id="edit-lga"
          name="lga"
          label={t("fields.lga")}
          defaultValue={details.lga}
          required
        />
        <FormError message={error} />
        {saved ? (
          <p aria-live="polite" className="text-base">
            {t("edit.saved")}
          </p>
        ) : null}
        <SubmitButton pending={pending} label={t("edit.save")} pendingLabel={t("edit.saving")} />
      </form>
    </details>
  );
}
