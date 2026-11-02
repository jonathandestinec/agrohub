"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { setFarmerBankAccountAction } from "./actions";
import { errorKey } from "./error-key";

export function FarmerBankForm({ banks }: { banks: Array<{ name: string; code: string }> }) {
  const t = useTranslations("farmer");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ accountName: string; pending: boolean } | null>(
    null,
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setError(null);
    setResult(null);
    const outcome = await setFarmerBankAccountAction(new FormData(form));
    setPending(false);
    if (!outcome.ok) {
      setError(t(errorKey(outcome.code)));
      return;
    }
    // The account number is not kept on the page once it has been sent.
    form.reset();
    setResult(outcome.data);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="bankCode" className="title-4">
          {t("bank.bank")}
        </label>
        <select
          id="bankCode"
          name="bankCode"
          required
          defaultValue=""
          className="min-h-12 w-full rounded-input bg-step px-4 body-3 text-ink"
        >
          <option value="" disabled>
            {t("bank.bankPlaceholder")}
          </option>
          {banks.map((bank) => (
            <option key={bank.code} value={bank.code}>
              {bank.name}
            </option>
          ))}
        </select>
      </div>
      <Field
        id="accountNumber"
        name="accountNumber"
        label={t("bank.accountNumber")}
        hint={t("bank.accountNumberHint")}
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]{10}"
        maxLength={10}
        required
      />
      <FormError message={error} />
      {result ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-inner bg-step p-4 body-3"
        >
          <p>{t("bank.saved", { accountName: result.accountName })}</p>
          {result.pending ? <p>{t("bank.pending")}</p> : null}
        </div>
      ) : null}
      <SubmitButton pending={pending} label={t("bank.save")} pendingLabel={t("bank.saving")} />
    </form>
  );
}
