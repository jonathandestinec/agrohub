"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { currentWeekKey, toWeekKey, weekStart } from "@/modules/board/week";
import type { CatalogItem } from "@/modules/catalog/views";
import { recordPriceAction } from "./actions";
import { boardErrorKey } from "./error-key";

const selectClass = "min-h-12 w-full rounded-input bg-step px-4 body-3 text-ink";

// The Monday a chosen day saves to, or null while the field is empty or half-typed.
function mondayOf(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : toWeekKey(weekStart(date));
}

export function PriceForm({
  crops,
  units,
  markets,
  weekOf,
}: {
  crops: CatalogItem[];
  units: CatalogItem[];
  markets: string[];
  weekOf: string;
}) {
  const t = useTranslations("board");
  const locale = useLocale();
  const [week, setWeek] = useState(weekOf);
  const [weekTouched, setWeekTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A tab left open past Sunday midnight follows the new week, unless the admin chose one.
  useEffect(() => {
    if (weekTouched) return;
    const follow = () => setWeek(currentWeekKey(new Date()));
    follow();
    window.addEventListener("focus", follow);
    document.addEventListener("visibilitychange", follow);
    return () => {
      window.removeEventListener("focus", follow);
      document.removeEventListener("visibilitychange", follow);
    };
  }, [weekTouched]);

  const savesTo = mondayOf(week);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const weekToSave = weekTouched ? week : currentWeekKey(new Date());
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await recordPriceAction({
      cropId: String(data.get("cropId") ?? ""),
      unitId: String(data.get("unitId") ?? ""),
      market: String(data.get("market") ?? ""),
      weekOf: weekToSave,
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
        list={markets.length > 0 ? "known-markets" : undefined}
      />
      {markets.length > 0 ? (
        <datalist id="known-markets" aria-label={t("entry.marketsLabel")}>
          {markets.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          id="weekOf"
          name="weekOf"
          type="date"
          label={t("entry.week")}
          hint={t("entry.weekHint")}
          required
          value={week}
          onChange={(e) => {
            setWeek(e.target.value);
            setWeekTouched(true);
          }}
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
      {savesTo ? (
        <p className="body-6 text-ink-soft">
          {t("entry.savesTo", {
            date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
              new Date(`${savesTo}T00:00:00Z`),
            ),
          })}
        </p>
      ) : null}
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
