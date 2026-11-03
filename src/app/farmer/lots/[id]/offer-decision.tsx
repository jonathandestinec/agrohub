"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { offerErrorKey } from "@/components/offers/error-key";
import { buttonClass } from "@/components/ui";
import { farmerRespondToOfferAction } from "../actions";

// Agreeing accepts the offer below the farmer's lowest price; declining rejects it.
export function OfferDecision({ offerId }: { offerId: string }) {
  const t = useTranslations("offers");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(agree: boolean) {
    setBusy(true);
    setError(null);
    const result = await farmerRespondToOfferAction({ offerId, agree });
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
        <button type="button" disabled={busy} className={`${buttonClass("ink")} w-full`} onClick={() => void answer(true)}>
          {t("farmer.agree")}
        </button>
        <button type="button" disabled={busy} className={`${buttonClass("paper")} w-full`} onClick={() => void answer(false)}>
          {t("farmer.decline")}
        </button>
      </div>
      <FormError message={error} />
    </div>
  );
}
