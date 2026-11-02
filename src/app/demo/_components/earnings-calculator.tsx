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

// The farmer's view before agreeing to sell: what the cooperative keeps, what AgroHub
// keeps and what reaches the farmer's bank account.
export function EarningsCalculator({ tone = "lime" }: { tone?: "lime" | "paper" }) {
  const id = useId();
  const [cropId, setCropId] = useState("maize");
  const [price, setPrice] = useState("64,850");
  const [quantity, setQuantity] = useState("30");
  const crop = CROPS.find((c) => c.id === cropId) ?? CROPS[0];
  const askKobo = parseKobo(price);
  const qty = parseQuantity(quantity);
  const b = askKobo !== null && qty !== null ? demoBreakdown(askKobo, qty, COOP_CUT_BPS, AGROHUB_FEE_BPS) : null;

  const field =
    "min-h-12 w-full rounded-xl bg-[var(--d-paper)] px-4 body-3 text-[var(--d-ink)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--d-ink)] aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-[var(--d-bad)]";

  return (
    <div
      className={`grid gap-6 rounded-3xl p-6 md:grid-cols-2 md:gap-8 md:p-8 ${
        tone === "lime" ? "bg-[var(--d-lime)] text-[var(--d-lime-ink)]" : "bg-[var(--d-step)]"
      }`}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()} aria-label="Lot details">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-crop`} className="title-4">Crop</label>
          <select id={`${id}-crop`} value={cropId} onChange={(e) => setCropId(e.target.value)} className={field}>
            {CROPS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}, per {c.unit}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-price`} className="title-4">Asking price (₦)</label>
            <input
              id={`${id}-price`}
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              aria-invalid={askKobo === null}
              aria-describedby={askKobo === null ? `${id}-price-error` : undefined}
              className={field}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-qty`} className="title-4">Quantity ({crop.unit}s)</label>
            <input
              id={`${id}-qty`}
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              aria-invalid={qty === null}
              aria-describedby={qty === null ? `${id}-qty-error` : undefined}
              className={field}
            />
          </div>
        </div>
        {askKobo === null ? (
          <p id={`${id}-price-error`} className="body-5 text-[var(--d-bad)]">Enter a price in naira, for example 64,850.</p>
        ) : null}
        {qty === null ? (
          <p id={`${id}-qty-error`} className="body-5 text-[var(--d-bad)]">Enter a whole number of {crop.unit}s.</p>
        ) : null}
      </form>

      <div aria-live="polite" className="flex flex-col justify-between gap-6">
        <dl className="flex flex-col gap-3 body-3">
          <Row label="Buyer pays" value={b ? formatNaira(b.grossKobo) : "None"} />
          <Row label="Cooperative cut, 5%" value={b ? `minus ${formatNaira(b.cooperativeKobo)}` : "None"} />
          <Row label="AgroHub fee, 3%" value={b ? `minus ${formatNaira(b.feeKobo)}` : "None"} />
        </dl>
        <div className="rounded-2xl bg-[var(--d-paper)] p-5 text-[var(--d-ink)]">
          <p className="body-5 text-[var(--d-ink-2)]">You take home</p>
          <p className="mt-1 heading-3">{b ? formatNaira(b.takeHomeKobo) : "None"}</p>
          <p className="mt-1 body-6 text-[var(--d-ink-2)]">
            {b ? `${formatNaira(b.takeHomePerUnitKobo)} per ${crop.unit}, paid to your bank after the buyer confirms delivery.` : "Check the price and quantity."}
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt>{label}</dt>
      <dd className="title-3">{value}</dd>
    </div>
  );
}
