"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { offerErrorKey } from "@/components/offers/error-key";
import { Button } from "@/components/ui";
import { respondToOfferAction } from "../actions";

const FIELD = "min-h-11 w-full rounded-tile bg-paper px-3 body-4 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink";

// Accept (below the floor this sends the offer to the farmer), reject, or counter, each with an
// optional message to the buyer.
export function OfficerOfferActions({ offerId, belowFloor }: { offerId: string; belowFloor: boolean }) {
  const t = useTranslations("offers");
  const router = useRouter();
  const [counter, setCounter] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(decision: "ACCEPT" | "REJECT" | "COUNTER") {
    setBusy(true);
    setError(null);
    const result = await respondToOfferAction({ offerId, decision, counter, message });
    setBusy(false);
    if (!result.ok) {
      setError(t(offerErrorKey(result.code)));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 rounded-inner bg-paper p-4 md:p-6">
      <label className="flex flex-col gap-1 body-6">
        {t("officer.message")}
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={2000}
          rows={3}
          className="min-h-24 w-full rounded-tile bg-step p-3 body-4 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink"
        />
        <span className="text-ink-soft">{t("officer.messageHint")}</span>
      </label>
      <div className="flex flex-col gap-2">
        {belowFloor ? <p className="body-5">{t("officer.belowFloorExplain")}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button tone="ink" disabled={busy} onClick={() => void answer("ACCEPT")}>
            {belowFloor ? t("officer.sendToFarmer") : t("officer.accept")}
          </Button>
          <Button tone="step" disabled={busy} onClick={() => void answer("REJECT")}>
            {t("officer.reject")}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 body-6">
          {t("officer.counterPrice")}
          <input
            inputMode="decimal"
            value={counter}
            onChange={(event) => setCounter(event.target.value)}
            className={`${FIELD} bg-step`}
          />
        </label>
        <Button tone="lime" disabled={busy || counter.trim() === ""} onClick={() => void answer("COUNTER")}>
          {t("officer.counter")}
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}
