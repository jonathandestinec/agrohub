"use client";

import { useState } from "react";
import { formatNaira } from "@/lib/money";
import { Button, Check, Chip, CropThumb } from "../_components/ui";
import { DELIVERIES, OFFERS, SCREENING_QUEUE, cropById, lotById } from "../_lib/data";

type Done = Record<string, string>;

export function OfficerDesk() {
  const [done, setDone] = useState<Done>({});
  const mark = (id: string, outcome: string) => setDone((d) => ({ ...d, [id]: outcome }));
  const open = SCREENING_QUEUE.filter((l) => !done[l.id]).length;

  return (
    <div className="mt-8 grid gap-3 lg:grid-cols-12">
      <section aria-labelledby="screening" className="rounded-3xl bg-[var(--d-step)] p-4 md:p-6 lg:col-span-7">
        <div className="flex items-center justify-between gap-3 px-2">
          <h2 id="screening" className="heading-5">Lots to screen</h2>
          <Chip tone={open ? "warn" : "forest"}>{open ? `${open} waiting` : "All done"}</Chip>
        </div>
        <ul className="mt-4 flex flex-col gap-2">
          {SCREENING_QUEUE.map((l) => {
            const crop = cropById(l.cropId);
            const diff = l.askKobo - l.boardKobo;
            const far = Math.abs(diff) * 10 > l.boardKobo; // more than 10% from the board
            const outcome = done[l.id];
            return (
              <li key={l.id} className="rounded-[20px] bg-[var(--d-paper)] p-4 md:p-5">
                <div className="flex items-start gap-4">
                  <CropThumb crop={crop} className="size-14" />
                  <div className="flex-1">
                    <p className="title-3">{crop.name}, {l.grade} · {l.quantity} {crop.unit}s</p>
                    <p className="caption-2 text-[var(--d-ink-2)]">{l.farmer} · {l.submitted}</p>
                    <p className="mt-2 body-5">
                      {formatNaira(l.askKobo)} per {crop.unit}
                      <span className={far ? "text-[var(--d-warn)]" : "text-[var(--d-ink-2)]"}>
                        {" "}· {formatNaira(Math.abs(diff))} {diff >= 0 ? "above" : "below"} the board
                      </span>
                    </p>
                    {l.note ? <p className="mt-2 body-6 text-[var(--d-ink-2)]">“{l.note}”</p> : null}
                  </div>
                </div>
                <div className="mt-4" aria-live="polite">
                  {outcome ? (
                    <p className="flex items-center gap-2 body-5 text-[var(--d-good)]"><Check /> {outcome}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button className="min-h-10" onClick={() => mark(l.id, "Approved. The lot is live and its fee terms are locked.")}>Approve</Button>
                      <Button tone="step" className="min-h-10" onClick={() => mark(l.id, `Counter sent to ${l.farmer.split(" ")[0]}.`)}>Suggest a price</Button>
                      <Button tone="step" className="min-h-10" onClick={() => mark(l.id, "Returned to the farmer with your reason.")}>Reject</Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-col gap-3 lg:col-span-5">
        <section aria-labelledby="offers" className="rounded-3xl bg-[var(--d-lime)] p-4 text-[var(--d-lime-ink)] md:p-6">
          <h2 id="offers" className="px-2 heading-5">Offers from buyers</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {OFFERS.map((o) => {
              const lot = lotById(o.lotId)!;
              const crop = cropById(lot.cropId);
              const outcome = done[o.id];
              return (
                <li key={o.id} className="rounded-[20px] bg-[var(--d-paper)] p-4 text-[var(--d-ink)]">
                  <p className="title-3">{o.buyer}</p>
                  <p className="body-6 text-[var(--d-ink-2)]">
                    {o.quantity} {crop.unit}s of {crop.name} at {formatNaira(o.offerKobo)} (asking {formatNaira(lot.askKobo)})
                  </p>
                  <p className="mt-1 caption-2 text-[var(--d-ink-2)]">Expires {o.expires}</p>
                  <div className="mt-3" aria-live="polite">
                    {outcome ? (
                      <p className="flex items-center gap-2 body-5 text-[var(--d-good)]"><Check /> {outcome}</p>
                    ) : o.aboveFloor ? (
                      <div className="flex flex-wrap gap-2">
                        <Button className="min-h-10" onClick={() => mark(o.id, "Accepted. Stock held for the buyer for 24 hours.")}>Accept</Button>
                        <Button tone="step" className="min-h-10" onClick={() => mark(o.id, "Counter offer sent.")}>Counter</Button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <Chip tone="warn">Below the farmers&apos; lowest price</Chip>
                        <div className="flex flex-wrap gap-2">
                          <Button tone="step" className="min-h-10" onClick={() => mark(o.id, "Asked the farmers to agree. The buyer sees no price detail.")}>Ask the farmers</Button>
                          <Button tone="step" className="min-h-10" onClick={() => mark(o.id, "Declined. The buyer was not told why.")}>Decline</Button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="deliveries" className="rounded-3xl bg-[var(--d-step)] p-4 md:p-6">
          <h2 id="deliveries" className="px-2 heading-5">Deliveries</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {DELIVERIES.map((d) => {
              const crop = cropById(lotById(d.lotId)!.cropId);
              const outcome = done[d.id];
              return (
                <li key={d.id} className="rounded-[20px] bg-[var(--d-paper)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="title-3">{d.buyer}</p>
                      <p className="body-6 text-[var(--d-ink-2)]">{d.quantity} {crop.unit}s of {crop.name} · {formatNaira(d.totalKobo)}</p>
                      <p className="caption-2 text-[var(--d-ink-2)]">Due {d.due}</p>
                    </div>
                    <Chip tone={d.status.startsWith("Paid") ? "lime" : "step"}>{outcome ? "Delivered, awaiting buyer" : d.status}</Chip>
                  </div>
                  {d.status.startsWith("Paid") ? (
                    <div className="mt-3" aria-live="polite">
                      {outcome ? (
                        <p className="flex items-center gap-2 body-5 text-[var(--d-good)]"><Check /> {outcome}</p>
                      ) : (
                        <Button className="min-h-10" onClick={() => mark(d.id, "Marked delivered. Payment is released when the buyer confirms, or in 3 days.")}>Mark delivered</Button>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
