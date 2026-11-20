"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BankAccountForm } from "@/components/bank/bank-account-form";
import { previewFarmerBankAccountAction, setFarmerBankAccountAction } from "./actions";
import { errorKey } from "./error-key";

type Bank = { name: string; code: string };

// `banks` is null when the page does not offer the form. Once the farmer saves here, the form
// stays (with its "Saved" confirmation) until they leave the page: the save refreshes the
// page, and on the join page that refresh no longer offers the form.
export function FarmerBankForm({ banks }: { banks: Bank[] | null }) {
  const t = useTranslations("farmer");
  const [savedWith, setSavedWith] = useState<Bank[] | null>(null);
  const list = banks ?? savedWith;
  if (!list) return null;
  return (
    <BankAccountForm
      banks={list}
      owner="farmer"
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
      lookup={previewFarmerBankAccountAction}
      save={setFarmerBankAccountAction}
      errorMessage={(code) => t(errorKey(code))}
      onSaved={() => setSavedWith(list)}
    />
  );
}
