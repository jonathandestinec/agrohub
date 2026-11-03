"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { offerErrorKey } from "@/components/offers/error-key";
import { buttonClass } from "@/components/ui";
import { respondToCounterAction, withdrawOfferAction } from "../../actions";

// The buyer's answers on an offer page: accept or decline a counter, or withdraw a live offer.
export function BuyerOfferActions({ offerId, countered }: { offerId: string; countered: boolean }) {
  const t = useTranslations("offers");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: true } | { ok: false; code: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(t(offerErrorKey(result.code)));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {countered ? (
          <>
            <button
              type="button"
              disabled={busy}
              className={`${buttonClass("ink")} w-full`}
              onClick={() => void run(() => respondToCounterAction({ offerId, accept: true }))}
            >
              {t("buyer.acceptCounter")}
            </button>
            <button
              type="button"
              disabled={busy}
              className={`${buttonClass("paper")} w-full`}
              onClick={() => void run(() => respondToCounterAction({ offerId, accept: false }))}
            >
              {t("buyer.declineCounter")}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            className={`${buttonClass("paper")} w-full`}
            onClick={() => void run(() => withdrawOfferAction({ offerId }))}
          >
            {t("buyer.withdraw")}
          </button>
        )}
      </div>
      <FormError message={error} />
    </div>
  );
}
