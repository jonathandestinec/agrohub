"use client";

import { useId, useState } from "react";
import { formatNaira, toKobo } from "@/lib/money";
import { Button, ButtonLink, Check } from "../../_components/ui";

export function BuyBox({
  lotId,
  unit,
  askKobo,
  available,
  minOrder,
  cooperative,
}: {
  lotId: string;
  unit: string;
  askKobo: number;
  available: number;
  minOrder: number;
  cooperative: string;
}) {
  const id = useId();
  const [qty, setQty] = useState(minOrder);
  const [mode, setMode] = useState<"buy" | "offer" | "sent">("buy");
  const [offer, setOffer] = useState("");
  const [offerError, setOfferError] = useState<string | null>(null);
  const clamp = (n: number) => Math.max(minOrder, Math.min(available, n));

  function sendOffer(e: React.FormEvent) {
    e.preventDefault();
    let kobo: number;
    try {
      kobo = toKobo(offer.replace(/,/g, "").trim());
    } catch {
      setOfferError("Enter a price per unit in naira, for example 62,000.");
      return;
    }
    if (kobo <= 0) {
      setOfferError("Enter a price above zero.");
      return;
    }
    setOfferError(null);
    setMode("sent");
  }

  return (
    <div className="flex flex-col gap-5 rounded-3xl bg-[var(--d-step)] p-6">
      <div>
        <p className="body-5 text-[var(--d-ink-2)]">Asking price</p>
        <p className="mt-1 heading-3">{formatNaira(askKobo)}</p>
        <p className="body-6 text-[var(--d-ink-2)]">per {unit} · {available} available</p>
      </div>

      <div className="flex flex-col gap-2">
        <span id={`${id}-qty`} className="title-4">Quantity ({unit}s)</span>
        <div className="flex items-center gap-2" role="group" aria-labelledby={`${id}-qty`}>
          <button type="button" aria-label="Fewer" onClick={() => setQty((q) => clamp(q - 5))} className="press size-12 rounded-full bg-[var(--d-paper)] heading-6 hover:bg-[var(--d-step-2)]">−</button>
          <output className="min-w-16 text-center heading-5" aria-live="polite">{qty}</output>
          <button type="button" aria-label="More" onClick={() => setQty((q) => clamp(q + 5))} className="press size-12 rounded-full bg-[var(--d-paper)] heading-6 hover:bg-[var(--d-step-2)]">+</button>
        </div>
        <p className="caption-2 text-[var(--d-ink-2)]">Minimum order {minOrder}.</p>
      </div>

      {mode === "buy" ? (
        <>
          <div className="flex items-baseline justify-between rounded-2xl bg-[var(--d-paper)] px-4 py-3">
            <span className="body-5">Total</span>
            <span className="heading-6">{formatNaira(askKobo * qty)}</span>
          </div>
          <ButtonLink href={`/demo/checkout/${lotId}?qty=${qty}`} className="min-h-12">Buy at the asking price</ButtonLink>
          <Button tone="paper" className="min-h-12" onClick={() => setMode("offer")}>Make an offer</Button>
        </>
      ) : null}

      {mode === "offer" ? (
        <form onSubmit={sendOffer} noValidate className="flex flex-col gap-3">
          <label htmlFor={`${id}-offer`} className="title-4">Your price per {unit} (₦)</label>
          <input
            id={`${id}-offer`}
            inputMode="decimal"
            autoFocus
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            aria-invalid={offerError !== null}
            aria-describedby={`${id}-offer-hint`}
            className="min-h-12 rounded-xl bg-[var(--d-paper)] px-4 body-3 outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--d-ink)] aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-[var(--d-bad)]"
          />
          <p id={`${id}-offer-hint`} className={`caption-2 ${offerError ? "text-[var(--d-bad)]" : "text-[var(--d-ink-2)]"}`}>
            {offerError ?? "The cooperative has 48 hours to accept, decline or counter."}
          </p>
          <div className="flex gap-2">
            <Button type="submit" className="min-h-12 flex-1">Send offer</Button>
            <Button tone="paper" className="min-h-12" onClick={() => setMode("buy")}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {mode === "sent" ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-[var(--d-paper)] p-4" role="status">
          <p className="flex items-center gap-2 title-3">
            <Check className="size-5 text-[var(--d-good)]" /> Offer sent to {cooperative}
          </p>
          <p className="body-6 text-[var(--d-ink-2)]">
            {qty} {unit}s at ₦{offer} each. You will get a message when the officer replies, within 48 hours.
          </p>
          <Button tone="step" onClick={() => { setMode("buy"); setOffer(""); }}>Done</Button>
        </div>
      ) : null}
    </div>
  );
}
