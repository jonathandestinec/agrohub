"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { Button } from "@/components/ui";
import { formatNaira, lineTotalKobo } from "@/lib/money";
import { startCheckoutAction } from "@/app/buyer/orders/actions";
import { orderErrorKey } from "./error-key";

const FIELD = "min-h-11 w-full rounded-tile bg-paper px-3 body-4 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink";

export type CheckoutQuote = { id: string; amountKobo: number; until: string };

// Buy now on a lot (quantity chosen) or pay an accepted offer (quantity fixed). Pickup, or a
// delivery quote the cooperative sent this buyer. On success the browser goes to Paystack.
export function CheckoutForm({
  source,
  lotId,
  offerId,
  unitKobo,
  unit,
  minQuantity,
  maxQuantity,
  fixedQuantity,
  pickupLabel,
  quotes,
}: {
  source: "LOT" | "OFFER";
  lotId?: string;
  offerId?: string;
  unitKobo: number;
  unit: string;
  minQuantity: number;
  maxQuantity: number;
  fixedQuantity?: number;
  pickupLabel: string;
  quotes: CheckoutQuote[];
}) {
  const t = useTranslations("orders");
  const [quantity, setQuantity] = useState(String(fixedQuantity ?? minQuantity));
  const [quoteId, setQuoteId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quote = quotes.find((q) => q.id === quoteId);
  const goods = /^\d{1,7}$/.test(quantity.trim()) ? lineTotalKobo(unitKobo, Number(quantity.trim())) : null;
  const total = goods === null ? null : goods + (quote?.amountKobo ?? 0);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await startCheckoutAction({
      source,
      lotId,
      offerId,
      quantity: fixedQuantity === undefined ? quantity : undefined,
      deliveryQuoteId: quoteId || undefined,
    });
    if (!result.ok) {
      setPending(false);
      setError(t(orderErrorKey(result.code)));
      return;
    }
    window.location.assign(result.data.authorizationUrl);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-inner bg-paper/60 p-4 md:p-6">
      {fixedQuantity === undefined ? (
        <label className="flex flex-col gap-1 body-6">
          {t("checkout.quantity", { unit })}
          <input
            name="quantity"
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
            className={FIELD}
          />
          <span className="text-ink-soft">{t("checkout.quantityHint", { min: minQuantity, max: maxQuantity })}</span>
        </label>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="body-6 mb-1">{t("checkout.delivery")}</legend>
        <label className="flex min-h-11 items-center gap-2 body-4">
          <input type="radio" name="delivery" value="" checked={quoteId === ""} onChange={() => setQuoteId("")} />
          {pickupLabel}
        </label>
        {quotes.map((q) => (
          <label key={q.id} className="flex min-h-11 items-center gap-2 body-4">
            <input type="radio" name="delivery" value={q.id} checked={quoteId === q.id} onChange={() => setQuoteId(q.id)} />
            {t("checkout.deliveryQuote", { amount: formatNaira(q.amountKobo), time: q.until })}
          </label>
        ))}
        {quotes.length === 0 ? <p className="body-6 text-ink-soft">{t("checkout.noQuotes")}</p> : null}
      </fieldset>
      <p className="heading-6 tabular-nums" aria-live="polite">
        {total === null ? t("checkout.totalUnknown") : t("checkout.total", { total: formatNaira(total) })}
      </p>
      <p className="body-6 text-ink-soft">{t("checkout.held")}</p>
      <p className="body-6 text-ink-soft">{t("checkout.reserved")}</p>
      <FormError message={error} />
      <div>
        <Button type="submit" tone="ink" size="lg" disabled={pending}>
          {pending ? t("checkout.redirecting") : t("checkout.submit")}
        </Button>
      </div>
    </form>
  );
}
