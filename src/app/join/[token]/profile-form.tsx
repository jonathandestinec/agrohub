"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { joinCooperativeAction } from "@/app/farmer/actions";
import { errorKey } from "@/app/farmer/error-key";

export function ProfileForm({ token, states }: { token: string; states: string[] }) {
  const t = useTranslations("farmer");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await joinCooperativeAction(token, new FormData(event.currentTarget));
    setPending(false);
    if (!result.ok) {
      setError(t(errorKey(result.code)));
      return;
    }
    // The page now shows the bank step.
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field
        id="farmSizeHectares"
        name="farmSizeHectares"
        label={t("profile.farmSize")}
        hint={t("profile.farmSizeHint")}
        inputMode="decimal"
        pattern="[0-9]+([.][0-9]{1,2})?"
        required
      />
      <Field
        id="crops"
        name="crops"
        label={t("profile.crops")}
        hint={t("profile.cropsHint")}
        required
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="state" className="title-4">
          {t("profile.state")}
        </label>
        <select
          id="state"
          name="state"
          required
          defaultValue=""
          className="min-h-12 w-full rounded-input bg-step px-4 body-3 text-ink"
        >
          <option value="" disabled>
            {t("profile.statePlaceholder")}
          </option>
          {states.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
      </div>
      <Field id="lga" name="lga" label={t("profile.lga")} maxLength={80} required />
      <FormError message={error} />
      <SubmitButton pending={pending} label={t("profile.submit")} pendingLabel={t("profile.submitting")} />
    </form>
  );
}
