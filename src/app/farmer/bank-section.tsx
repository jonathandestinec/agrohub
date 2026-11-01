import { getLocale, getTranslations } from "next-intl/server";
import { listBanks, type Bank } from "@/lib/paystack";
import type { BankAccountView } from "@/modules/banking/views";
import { formatEffectiveAt } from "@/modules/banking/views";
import { FarmerBankForm } from "./bank-form";

// The farmer's payout account: the current account name, any pending change, and the
// form to add or change it (shown only while the farmer holds a membership).
export async function FarmerBankSection({
  bank,
  canChange,
}: {
  bank: BankAccountView | null;
  canChange: boolean;
}) {
  const t = await getTranslations("farmer.bank");
  const locale = await getLocale();
  // Paystack can be unreachable or unconfigured; the rest of the page must still render.
  let banks: Bank[] | null = null;
  if (canChange) {
    try {
      banks = await listBanks();
    } catch {
      banks = null;
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">
        {t("heading")}
      </h2>
      <p className="text-sm text-muted">{t("intro")}</p>
      <p className="rounded-md border border-border bg-surface px-3 py-3 text-base">
        {bank?.accountName ? t("current", { accountName: bank.accountName }) : t("none")}
      </p>
      {bank?.change?.state === "AWAITING_CONFIRMATION" ? (
        <p role="status" className="text-base">
          {t("pending")}
        </p>
      ) : null}
      {bank?.change?.state === "CONFIRMED" ? (
        <p role="status" className="text-base">
          {t("confirmed", { date: formatEffectiveAt(bank.change.effectiveAt, locale) })}
        </p>
      ) : null}
      {canChange ? (
        banks ? (
          <FarmerBankForm banks={banks} />
        ) : (
          <p role="alert" className="text-base">
            {t("unavailable")}
          </p>
        )
      ) : null}
    </section>
  );
}
