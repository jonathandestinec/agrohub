"use client";

import { useTranslations } from "next-intl";
import { BankAccountForm } from "@/components/bank/bank-account-form";
import { previewFarmerBankAccountAction, setFarmerBankAccountAction } from "./actions";
import { errorKey } from "./error-key";

export function FarmerBankForm({ banks }: { banks: Array<{ name: string; code: string }> }) {
  const t = useTranslations("farmer");
  return (
    <BankAccountForm
      banks={banks}
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
    />
  );
}
