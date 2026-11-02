"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { createCooperativeAction } from "../actions";
import { errorKey } from "./error-key";

export function CreateCooperativeForm({ states }: { states: string[] }) {
  const t = useTranslations("officer.onboarding");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await createCooperativeAction(new FormData(event.currentTarget));
    setPending(false);
    if (!result.ok) {
      setError(t(errorKey(result.code)));
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field id="name" name="name" label={t("fields.name")} required />
      <Field
        id="registrationNumber"
        name="registrationNumber"
        label={t("fields.registrationNumber")}
        required
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="state" className="title-4">
          {t("fields.state")}
        </label>
        <select
          id="state"
          name="state"
          required
          defaultValue=""
          className="min-h-12 w-full rounded-input bg-step px-4 body-3 text-ink"
        >
          <option value="" disabled>
            {t("fields.statePlaceholder")}
          </option>
          {states.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
      </div>
      <Field id="lga" name="lga" label={t("fields.lga")} required />
      <Field
        id="certificateExpiresAt"
        name="certificateExpiresAt"
        type="date"
        label={t("fields.certificateExpiresAt")}
        required
      />
      <FormError message={error} />
      <SubmitButton pending={pending} label={t("create")} pendingLabel={t("creating")} />
    </form>
  );
}
