"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import type { ActionResult } from "@/lib/action-result";

type Preview = { accountName: string; matches: boolean; registeredName: string };
type Lookup =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "found"; preview: Preview }
  | { state: "failed"; code: string };

// The bank form for farmers and cooperatives. Once a bank is chosen and ten digits are
// typed, it asks the bank for the account name and shows it, with whether it matches the
// registered name, before anything is saved. The save still checks everything on the server.
export function BankAccountForm({
  banks,
  owner,
  labels,
  lookup,
  save,
  errorMessage,
}: {
  banks: Array<{ name: string; code: string }>;
  owner: "farmer" | "cooperative";
  // Field labels and save copy from the page's own message namespace.
  labels: {
    bank: string;
    bankPlaceholder: string;
    accountNumber: string;
    accountNumberHint: string;
    save: string;
    saving: string;
    saved: (accountName: string) => string;
    pending: string;
  };
  lookup: (input: { bankCode: string; accountNumber: string }) => Promise<ActionResult<Preview>>;
  save: (form: FormData) => Promise<ActionResult<{ accountName: string; pending: boolean }>>;
  errorMessage: (code: string) => string;
}) {
  const t = useTranslations("bankLookup");
  const router = useRouter();
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [lookupState, setLookupState] = useState<Lookup>({ state: "idle" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ accountName: string; pending: boolean } | null>(null);
  // The latest bank and number asked about; an older answer arriving late is ignored.
  const latest = useRef("");

  async function check(code: string, number: string) {
    const key = `${code}:${number}`;
    if (!code || !/^\d{10}$/.test(number)) {
      latest.current = "";
      setLookupState({ state: "idle" });
      return;
    }
    if (key === latest.current) return;
    latest.current = key;
    setLookupState({ state: "checking" });
    const outcome = await lookup({ bankCode: code, accountNumber: number });
    if (latest.current !== key) return;
    setLookupState(outcome.ok ? { state: "found", preview: outcome.data } : { state: "failed", code: outcome.code });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setError(null);
    setResult(null);
    const outcome = await save(new FormData(form));
    setPending(false);
    if (!outcome.ok) {
      setError(errorMessage(outcome.code));
      return;
    }
    // The account number is not kept on the page once it has been sent.
    form.reset();
    setBankCode("");
    setAccountNumber("");
    latest.current = "";
    setLookupState({ state: "idle" });
    setResult(outcome.data);
    router.refresh();
  }

  const mismatch = lookupState.state === "found" && !lookupState.preview.matches;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="bankCode" className="title-4">
          {labels.bank}
        </label>
        <select
          id="bankCode"
          name="bankCode"
          required
          value={bankCode}
          onChange={(e) => {
            setBankCode(e.target.value);
            void check(e.target.value, accountNumber);
          }}
          className="min-h-12 w-full rounded-input bg-step px-4 body-3 text-ink"
        >
          <option value="" disabled>
            {labels.bankPlaceholder}
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
        label={labels.accountNumber}
        hint={labels.accountNumberHint}
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]{10}"
        maxLength={10}
        required
        value={accountNumber}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
          setAccountNumber(digits);
          void check(bankCode, digits);
        }}
      />
      <div aria-live="polite">
        {lookupState.state === "checking" ? (
          <p className="body-6 text-ink-soft">{t("checking")}</p>
        ) : lookupState.state === "found" ? (
          <div className={`flex flex-col gap-1 rounded-inner p-4 body-3 ${mismatch ? "bg-warn-soft" : "bg-step"}`}>
            <p>
              {t("found")} <span className="title-4">{lookupState.preview.accountName}</span>
            </p>
            <p className="body-6">
              {lookupState.preview.matches
                ? t(`matches.${owner}`)
                : t(`mismatch.${owner}`, { name: lookupState.preview.registeredName })}
            </p>
          </div>
        ) : lookupState.state === "failed" ? (
          <p className="body-6 text-ink-soft">{t(lookupErrorKey(lookupState.code))}</p>
        ) : null}
      </div>
      <FormError message={error} />
      {result ? (
        <div role="status" className="flex flex-col gap-2 rounded-inner bg-step p-4 body-3">
          <p>{labels.saved(result.accountName)}</p>
          {result.pending ? <p>{labels.pending}</p> : null}
        </div>
      ) : null}
      <SubmitButton pending={pending} disabled={mismatch} label={labels.save} pendingLabel={labels.saving} />
    </form>
  );
}

function lookupErrorKey(
  code: string,
): "errors.notFound" | "errors.unavailable" | "errors.nameChangePending" | "errors.other" {
  if (code === "BANK_ACCOUNT_NOT_FOUND") return "errors.notFound";
  if (code === "NAME_CHANGE_PENDING") return "errors.nameChangePending";
  if (code === "PAYSTACK_UNAVAILABLE") return "errors.unavailable";
  return "errors.other";
}
