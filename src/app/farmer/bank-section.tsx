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
      <h2 className="heading-6">
        {t("heading")}
      </h2>
      <p className="body-6 text-ink-soft">{t("intro")}</p>
      <p className="rounded-inner bg-step p-4 body-3">
        {bank?.accountName ? t("current", { accountName: bank.accountName }) : t("none")}
      </p>
      {bank?.change?.state === "AWAITING_CONFIRMATION" ? (
        <p role="status" className="body-3">
          {t("pending")}
        </p>
      ) : null}
      {bank?.change?.state === "CONFIRMED" ? (
        <p role="status" className="body-3">
          {t("confirmed", { date: formatEffectiveAt(bank.change.effectiveAt, locale) })}
        </p>
      ) : null}
      {canChange ? (
        banks ? (
          <FarmerBankForm banks={banks} />
        ) : (
          <p role="alert" className="body-3">
            {t("unavailable")}
          </p>
        )
      ) : null}
    </section>
  );
}
