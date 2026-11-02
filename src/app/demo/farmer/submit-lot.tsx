"use client";

import { useId, useState } from "react";
import { Button, Check } from "../_components/ui";

export function SubmitLot() {
  const id = useId();
  const [sent, setSent] = useState(false);
  const field =
    "min-h-12 w-full rounded-xl bg-[var(--d-paper)] px-4 body-3 outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--d-ink)]";

  if (sent) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-3xl bg-[var(--d-forest)] p-6 text-[var(--d-forest-ink)]">
        <p className="flex items-center gap-2 heading-6"><Check className="size-5" /> Sent to your officer</p>
        <p className="body-6 opacity-80">You will get an email when it is approved, or if your officer suggests another price.</p>
        <div><Button tone="lime" className="mt-2" onClick={() => setSent(false)}>List another</Button></div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setSent(true); }}
      className="grid gap-4 rounded-3xl bg-[var(--d-step)] p-6 md:grid-cols-[1fr_2fr_auto] md:items-end md:p-8"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-floor`} className="title-4">Lowest price you would accept (₦)</label>
        <input id={`${id}-floor`} inputMode="decimal" defaultValue="61,500" aria-describedby={`${id}-floor-hint`} className={field} />
        <p id={`${id}-floor-hint`} className="caption-2 text-[var(--d-ink-2)]">Private. Buyers never see it.</p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-note`} className="title-4">Note for buyers</label>
        <input id={`${id}-note`} defaultValue="Sun dried, moisture tested at 13%." className={field} />
        <p className="caption-2 text-[var(--d-ink-2)]">Optional.</p>
      </div>
      <Button type="submit" className="min-h-12 md:mb-7">Send for approval</Button>
    </form>
  );
}
