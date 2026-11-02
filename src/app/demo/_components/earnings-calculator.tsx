"use client";

import { useId, useState } from "react";
import { formatNaira, toKobo } from "@/lib/money";
import { demoBreakdown } from "../_lib/breakdown";
import { AGROHUB_FEE_BPS, COOP_CUT_BPS, CROPS } from "../_lib/data";

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

const FARMER_BPS = 10000 - COOP_CUT_BPS - AGROHUB_FEE_BPS;
const percent = (bps: number) => `${bps / 100}%`;

// The farmer's view before agreeing to sell. The answer comes first: what reaches the
// farmer's bank. The lot reads as one sentence, and the full breakdown is one tap away.
export function EarningsCalculator({ tone = "lime" }: { tone?: "lime" | "paper" }) {
  const id = useId();
  const [cropId, setCropId] = useState("maize");
  const [price, setPrice] = useState("64,850");
  const [quantity, setQuantity] = useState("30");
  const crop = CROPS.find((c) => c.id === cropId) ?? CROPS[0];
  const askKobo = parseKobo(price);
  const qty = parseQuantity(quantity);
  const b = askKobo !== null && qty !== null ? demoBreakdown(askKobo, qty, COOP_CUT_BPS, AGROHUB_FEE_BPS) : null;

  return (
    <div
      className={`flex flex-col gap-6 rounded-3xl p-6 md:p-8 ${
        tone === "lime" ? "bg-[var(--d-lime)] text-[var(--d-lime-ink)]" : "bg-[var(--d-step)] text-[var(--d-ink)]"
      }`}
    >
      <div aria-live="polite">
        <p className="title-3">You take home</p>
        <p className="calc-total mt-2">{b ? formatNaira(b.takeHomeKobo) : "Check your numbers"}</p>
        <p className="mt-3 body-3">
          {b ? `${formatNaira(b.takeHomePerUnitKobo)} per ${crop.unit}, paid after delivery.` : "Enter a price in naira and a whole number."}
        </p>
      </div>

      <form onSubmit={(e) => e.preventDefault()} aria-label="Lot details" className="flex flex-wrap items-center gap-x-2 gap-y-3 body-1">
        <span>Selling</span>
        <label className="sr-only" htmlFor={`${id}-qty`}>Quantity</label>
        <input
          id={`${id}-qty`}
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          aria-invalid={qty === null}
          className="calc-pill w-20 text-center"
        />
        <label className="sr-only" htmlFor={`${id}-crop`}>Crop</label>
        <select id={`${id}-crop`} value={cropId} onChange={(e) => setCropId(e.target.value)} className="calc-pill">
          {CROPS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.unit}s of {c.name.toLowerCase()}
            </option>
          ))}
        </select>
        <span>at</span>
        <label className="sr-only" htmlFor={`${id}-price`}>Asking price in naira per unit</label>
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
        <span>each</span>
      </form>

      {b ? (
        <div className="flex flex-col gap-2">
          <div className="flex h-3 overflow-hidden rounded-full bg-[var(--d-paper)]" aria-hidden="true">
            <span className="calc-seg bg-[var(--d-forest)]" style={{ flexGrow: FARMER_BPS }} />
            <span className="calc-seg bg-[var(--d-lime-ink)]/30" style={{ flexGrow: COOP_CUT_BPS + AGROHUB_FEE_BPS }} />
          </div>
          <p className="flex justify-between gap-4 body-5">
            <span>You keep {percent(FARMER_BPS)}</span>
            <span>
              Cooperative {percent(COOP_CUT_BPS)}, AgroHub {percent(AGROHUB_FEE_BPS)}
            </span>
          </p>
          <details className="mt-2">
            <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center body-5 underline underline-offset-4 [&::-webkit-details-marker]:hidden">
              See the full breakdown
            </summary>
            <dl className="mt-2 flex flex-col gap-2 rounded-2xl bg-[var(--d-paper)] p-4 body-6 text-[var(--d-ink)]">
              <Line label="Buyer pays" value={formatNaira(b.grossKobo)} />
              <Line label={`Cooperative, ${percent(COOP_CUT_BPS)}`} value={`minus ${formatNaira(b.cooperativeKobo)}`} />
              <Line label={`AgroHub, ${percent(AGROHUB_FEE_BPS)}`} value={`minus ${formatNaira(b.feeKobo)}`} />
              <div className="flex justify-between gap-4 pt-2 title-3">
                <dt>You take home</dt>
                <dd className="tabular-nums">{formatNaira(b.takeHomeKobo)}</dd>
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
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
