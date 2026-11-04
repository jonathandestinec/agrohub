"use client";

import { useTranslations } from "next-intl";
import { BankAccountForm } from "@/components/bank/bank-account-form";
import { previewBankAccountAction, setBankAccountAction } from "../actions";
import { errorKey } from "./error-key";

export function BankForm({ banks }: { banks: Array<{ name: string; code: string }> }) {
  const t = useTranslations("officer.onboarding");
  return (
    <BankAccountForm
      banks={banks}
      owner="cooperative"
      labels={{
        bank: t("bank.bank"),
        bankPlaceholder: t("bank.bankPlaceholder"),
        accountNumber: t("bank.accountNumber"),
        accountNumberHint: t("bank.accountNumberHint"),
        save: t("bank.save"),
        saving: t("bank.saving"),
        saved: (accountName) => t("bank.saved", { accountName }),
        pending: t("bank.pending"),
      }}
      lookup={previewBankAccountAction}
      save={setBankAccountAction}
      errorMessage={(code) => t(errorKey(code))}
    />
  );
}
