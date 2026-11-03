"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { Breakdown } from "@/components/lots/breakdown";
import { lotErrorKey } from "@/components/lots/error-key";
import { buttonClass } from "@/components/ui/button";
import { toKobo } from "@/lib/money";
import { askDeviation } from "@/modules/board/deviation";
import type { BoardPrice } from "@/modules/board/service";
import type { FarmerLot } from "@/modules/catalog/views";
import { requestRevisionAction, withdrawLotAction } from "../actions";

function kobo(value: string): number | null {
  try {
    const amount = toKobo(value.trim().replace(/,/g, ""));
    return amount > 0 ? amount : null;
  } catch {
    return null;
  }
}

const naira = (k: number) => (k / 100).toFixed(2).replace(/\.00$/, "");

// A live lot's price, quantity or floor change goes to the officer; the live version stays
// until they approve it. The locked terms apply to the new price too.
export function ReviseForm({
  lot,
  boardPrices,
  priceDeviationBps,
}: {
  lot: FarmerLot;
  boardPrices: BoardPrice[];
  priceDeviationBps: number;
}) {
  const t = useTranslations("lots");
  const router = useRouter();
  const [ask, setAsk] = useState(naira(lot.askKobo));
  const [quantity, setQuantity] = useState(String(lot.quantity));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terms = lot.lockedTerms ?? lot.quoted;

  const askKobo = kobo(ask);
  const qty = /^\d{1,7}$/.test(quantity) ? Number(quantity) : null;
  const deviation =
    askKobo !== null ? askDeviation(askKobo, boardPrices.map((b) => b.priceKobo), priceDeviationBps) : null;
  const warned = deviation === "HIGH" || deviation === "LOW";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await requestRevisionAction(new FormData(event.currentTarget));
    setPending(false);
    if (!result.ok) {
      setError(t(lotErrorKey(result.code)));
      return;
    }
    router.refresh();
  }

  return (
    <details className="rounded-inner bg-step p-4 md:p-6 [&_input]:bg-paper [&_textarea]:bg-paper">
      <summary className="flex min-h-11 cursor-pointer items-center title-3">{t("revise.heading")}</summary>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-4">
        <p className="body-6 text-ink-soft">{t("revise.intro")}</p>
        <input type="hidden" name="lotId" value={lot.id} />
        <div className="grid gap-4 md:grid-cols-3">
          <Field id="revise-ask" name="ask" label={t("form.ask")} inputMode="decimal" required value={ask} onChange={(e) => setAsk(e.target.value)} />
          <Field id="revise-quantity" name="quantity" label={t("form.quantity")} inputMode="numeric" required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <Field id="revise-floor" name="floor" label={t("form.floor")} inputMode="decimal" required defaultValue={naira(lot.floorKobo)} />
        </div>
        {warned ? (
          <p role="status" className="rounded-inner bg-paper p-4 body-3">
            {deviation === "HIGH" ? t("form.warningHigh") : t("form.warningLow")} {t("form.warningNote")}
          </p>
        ) : null}
        {askKobo !== null && qty !== null && qty > 0 ? (
          <Breakdown askKobo={askKobo} quantity={qty} cutBps={terms.cooperativeCutBps} feeBps={terms.platformFeeBps} unit={lot.unit.name} />
        ) : null}
        <div className="flex flex-col gap-2">
          <label htmlFor="revise-note" className="title-4">
            {warned ? t("form.noteRequired") : t("form.note")}
          </label>
          <textarea
            id="revise-note"
            name="note"
            rows={2}
            maxLength={500}
            required={warned}
            minLength={warned ? 10 : undefined}
            className="w-full rounded-input px-4 py-3 body-3 text-ink"
          />
        </div>
        <FormError message={error} />
        <SubmitButton pending={pending} label={t("revise.submit")} pendingLabel={t("form.submitting")} />
      </form>
    </details>
  );
}

export function WithdrawButton({ lotId }: { lotId: string }) {
  const t = useTranslations("lots");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    setError(null);
    const result = await withdrawLotAction({ lotId });
    setBusy(false);
    if (!result.ok) {
      setError(t(lotErrorKey(result.code)));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {confirming ? (
        <>
          <p className="body-3">{t("withdraw.confirm")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={busy} className={`${buttonClass("ink")} w-full`} onClick={() => void withdraw()}>
              {t("withdraw.yes")}
            </button>
            <button type="button" disabled={busy} className={`${buttonClass("paper")} w-full`} onClick={() => setConfirming(false)}>
              {t("withdraw.no")}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className={`${buttonClass("paper")} w-full`} onClick={() => setConfirming(true)}>
          {t("withdraw.button")}
        </button>
      )}
      <FormError message={error} />
    </div>
  );
}
