"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { formatNaira, saleBreakdown, toKobo } from "@/lib/money";

// An example only: real fee terms are set per cooperative and locked to each lot.
const COOP_CUT_BPS = 500;
const AGROHUB_FEE_BPS = 300;
const FARMER_BPS = 10000 - COOP_CUT_BPS - AGROHUB_FEE_BPS;
const CROPS = ["maize", "rice", "soybeans", "sorghum", "yam", "tomatoes"] as const;
type CropId = (typeof CROPS)[number];

function parseKobo(naira: string): number | null {
  try {
    return toKobo(naira.replace(/,/g, "").trim());
  } catch {
    return null;
  }
}

function parseQuantity(value: string): number | null {
  return /^\d{1,5}$/.test(value.trim()) ? Number(value.trim()) : null;
}

const percent = (bps: number) => `${bps / 100}%`;

// The farmer's view before agreeing to sell. The answer comes first: what reaches the
// farmer's bank. The lot reads as one sentence, and the full breakdown is one tap away.
export function EarningsCalculator() {
  const t = useTranslations("landing.calc");
  const id = useId();
  const [cropId, setCropId] = useState<CropId>("maize");
  const [price, setPrice] = useState("64,850");
  const [quantity, setQuantity] = useState("30");
  const askKobo = parseKobo(price);
  const qty = parseQuantity(quantity);
  const b = askKobo !== null && qty !== null ? saleBreakdown(askKobo, qty, COOP_CUT_BPS, AGROHUB_FEE_BPS) : null;
  const unit = t(`crops.${cropId}.unit`);

  return (
    <div className="flex flex-col gap-7 rounded-panel bg-lime p-6 text-lime-ink md:p-8">
      <div className="grid gap-1.5" aria-live="polite">
        <p className="title-3">{t("takeHome")}</p>
        <p className="calc-total">{b ? formatNaira(b.takeHomeKobo) : t("checkNumbers")}</p>
        <p className="body-3">
          {b ? t("perUnit", { amount: formatNaira(b.takeHomePerUnitKobo), unit }) : t("enterNumbers")}
        </p>
      </div>

      <form onSubmit={(e) => e.preventDefault()} aria-label={t("formLabel")} className="flex flex-wrap items-center gap-x-2 gap-y-2.5 pt-1 body-1">
        <span>{t("selling")}</span>
        <label className="sr-only" htmlFor={`${id}-qty`}>
          {t("quantity")}
        </label>
        <input
          id={`${id}-qty`}
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          aria-invalid={qty === null}
          className="calc-pill w-20 text-center"
        />
        <label className="sr-only" htmlFor={`${id}-crop`}>
          {t("crop")}
        </label>
        <select id={`${id}-crop`} value={cropId} onChange={(e) => setCropId(e.target.value as CropId)} className="calc-pill">
          {CROPS.map((c) => (
            <option key={c} value={c}>
              {t("cropOption", { unit: t(`crops.${c}.unit`), crop: t(`crops.${c}.name`) })}
            </option>
          ))}
        </select>
        <span>{t("at")}</span>
        <label className="sr-only" htmlFor={`${id}-price`}>
          {t("price")}
        </label>
        <span className="calc-pill flex items-center gap-1">
          ₦
          <input
            id={`${id}-price`}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            aria-invalid={askKobo === null}
            className="w-24 bg-transparent font-semibold outline-none"
          />
        </span>
        <span>{t("each")}</span>
      </form>

      {b ? (
        <div className="grid gap-2.5">
          <div className="flex h-3 overflow-hidden rounded-full bg-paper" aria-hidden="true">
            <span className="calc-seg bg-forest" style={{ flexGrow: FARMER_BPS }} />
            <span className="calc-seg bg-lime-ink/30" style={{ flexGrow: COOP_CUT_BPS + AGROHUB_FEE_BPS }} />
          </div>
          <p className="flex flex-wrap gap-x-5 gap-y-1.5 body-5">
            <span className="inline-flex items-center gap-2">
              <span className="size-2.5 flex-none rounded-full bg-forest" aria-hidden="true" />
              {t("youKeep", { percent: percent(FARMER_BPS) })}
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="size-2.5 flex-none rounded-full bg-lime-ink/30" aria-hidden="true" />
              {t("split", { cut: percent(COOP_CUT_BPS), fee: percent(AGROHUB_FEE_BPS) })}
            </span>
          </p>
          <details className="calc-more">
            <summary className="body-5">
              {t("fullBreakdown")}
              <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
                <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>
            <dl className="mt-3 flex flex-col gap-2 rounded-2xl bg-paper p-4 body-6 text-ink">
              <Line label={t("buyerPays")} value={formatNaira(b.grossKobo)} />
              <Line label={t("cooperative", { percent: percent(COOP_CUT_BPS) })} value={t("minus", { amount: formatNaira(b.cooperativeKobo) })} />
              <Line label={t("agrohub", { percent: percent(AGROHUB_FEE_BPS) })} value={t("minus", { amount: formatNaira(b.feeKobo) })} />
              <div className="flex justify-between gap-4 pt-2 title-3">
                <dt>{t("takeHome")}</dt>
                <dd>{formatNaira(b.takeHomeKobo)}</dd>
              </div>
            </dl>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
