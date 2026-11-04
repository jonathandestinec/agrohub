"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { offerErrorKey } from "@/components/offers/error-key";
import { Button } from "@/components/ui";
import { formatNaira, lineTotalKobo, nairaInput, toKobo } from "@/lib/money";
import { makeOfferAction } from "@/app/buyer/actions";

const FIELD = "min-h-11 w-full rounded-tile bg-paper px-3 body-4 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink";

// The total for what is typed, or null while the fields do not parse.
function liveTotal(quantity: string, price: string): number | null {
  if (!/^\d{1,7}$/.test(quantity.trim())) return null;
  try {
    return lineTotalKobo(toKobo(price.trim().replace(/,/g, "")), Number(quantity.trim()));
  } catch {
    return null;
  }
}

export function OfferForm({
  lotId,
  askKobo,
  minOrderQty,
  quantity: lotQuantity,
  unit,
}: {
  lotId: string;
  askKobo: number;
  minOrderQty: number;
  quantity: number;
  unit: string;
}) {
  const t = useTranslations("offers");
  const router = useRouter();
  const [quantity, setQuantity] = useState(String(minOrderQty));
  const [price, setPrice] = useState(nairaInput(askKobo));
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = liveTotal(quantity, price);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await makeOfferAction({ lotId, quantity, price, message });
    if (!result.ok) {
      setPending(false);
      setError(t(offerErrorKey(result.code)));
      return;
    }
    router.push(`/buyer/offers/${result.data.offerId}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-inner bg-paper/60 p-4 md:p-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 body-6">
          {t("form.quantity", { unit })}
          <input
            name="quantity"
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
            className={FIELD}
          />
          <span className="text-ink-soft">{t("form.quantityHint", { min: minOrderQty, max: lotQuantity })}</span>
        </label>
        <label className="flex flex-col gap-1 body-6">
          {t("form.price", { unit })}
          <input
            name="price"
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            required
            className={FIELD}
          />
          <span className="text-ink-soft">{t("form.priceHint", { ask: formatNaira(askKobo) })}</span>
        </label>
      </div>
      <p className="heading-6 tabular-nums" aria-live="polite">
        {total === null ? t("form.totalUnknown") : t("form.total", { total: formatNaira(total) })}
      </p>
      <label className="flex flex-col gap-1 body-6">
        {t("form.message")}
        <textarea
          name="message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={2000}
          rows={3}
          className="min-h-24 w-full rounded-tile bg-paper p-3 body-4 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink"
        />
      </label>
      <p className="body-6 text-ink-soft">{t("form.explainer")}</p>
      <FormError message={error} />
      <div>
        <Button type="submit" tone="ink" size="lg" disabled={pending}>
          {t("form.submit")}
        </Button>
      </div>
    </form>
  );
}
