"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import type { CatalogItem } from "@/modules/catalog/views";
import { recordPriceAction } from "./actions";
import { boardErrorKey } from "./error-key";

const selectClass = "min-h-12 w-full rounded-input bg-step px-4 body-3 text-ink";

export function PriceForm({
  crops,
  units,
  weekOf,
}: {
  crops: CatalogItem[];
  units: CatalogItem[];
  weekOf: string;
}) {
  const t = useTranslations("board");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await recordPriceAction({
      cropId: String(data.get("cropId") ?? ""),
      unitId: String(data.get("unitId") ?? ""),
      market: String(data.get("market") ?? ""),
      weekOf: String(data.get("weekOf") ?? ""),
      price: String(data.get("price") ?? ""),
    });
    setPending(false);
    if (result.ok) {
      setSaved(true);
      (form.elements.namedItem("price") as HTMLInputElement | null)?.select();
    } else {
      setError(t(boardErrorKey(result.code)));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="cropId" className="title-4">
            {t("entry.crop")}
          </label>
          <select id="cropId" name="cropId" required defaultValue="" className={selectClass}>
            <option value="" disabled>
              {t("entry.choose")}
            </option>
            {crops.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="unitId" className="title-4">
            {t("entry.unit")}
          </label>
          <select id="unitId" name="unitId" required defaultValue="" className={selectClass}>
            <option value="" disabled>
              {t("entry.choose")}
            </option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Field
        id="market"
        name="market"
        label={t("entry.market")}
        hint={t("entry.marketHint")}
        required
        maxLength={80}
        autoComplete="off"
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          id="weekOf"
          name="weekOf"
          type="date"
          label={t("entry.week")}
          hint={t("entry.weekHint")}
          required
          defaultValue={weekOf}
        />
        <Field
          id="price"
          name="price"
          label={t("entry.price")}
          hint={t("entry.priceHint")}
          required
          inputMode="decimal"
          autoComplete="off"
        />
      </div>
      <FormError message={error} />
      {saved ? (
        <p role="status" className="body-6 text-ink-soft">
          {t("entry.saved")}
        </p>
      ) : null}
      <SubmitButton pending={pending} label={t("entry.save")} pendingLabel={t("entry.saving")} />
    </form>
  );
}
