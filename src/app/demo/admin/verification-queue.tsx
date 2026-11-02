"use client";

import { useState } from "react";
import { Button, Check, Chip } from "../_components/ui";
import { VERIFICATION_QUEUE } from "../_lib/data";

const REQUIRED = ["Registration certificate", "By-laws", "Officer list"];

export function VerificationQueue() {
  const [done, setDone] = useState<Record<string, string>>({});
  const waiting = VERIFICATION_QUEUE.filter((c) => !done[c.id]).length;

  return (
    <section aria-labelledby="queue" className="rounded-3xl bg-[var(--d-lime)] p-4 text-[var(--d-lime-ink)] md:p-6 lg:col-span-8">
      <div className="flex items-center justify-between gap-3 px-2">
        <h2 id="queue" className="heading-5">Waiting for review</h2>
        <Chip tone={waiting ? "step" : "forest"}>{waiting ? `${waiting} cooperatives` : "Queue clear"}</Chip>
      </div>
      <ul className="mt-4 flex flex-col gap-2">
        {VERIFICATION_QUEUE.map((c) => {
          const docs: readonly string[] = c.documents;
          const missing = REQUIRED.filter((d) => !docs.includes(d));
          const outcome = done[c.id];
          return (
            <li key={c.id} className="rounded-[20px] bg-[var(--d-paper)] p-4 text-[var(--d-ink)] md:p-5">
              <div className="flex flex-col justify-between gap-2 md:flex-row md:items-start">
                <div>
                  <p className="heading-6">{c.name}</p>
                  <p className="caption-2 text-[var(--d-ink-2)]">{c.state} · officer {c.officer} · submitted {c.submitted}</p>
                </div>
                <Chip tone={c.waitingDays >= 3 ? "warn" : "step"}>Waiting {c.waitingDays === 1 ? "1 day" : `${c.waitingDays} days`}</Chip>
              </div>
              <ul className="mt-4 flex flex-wrap gap-2" aria-label="Documents">
                {REQUIRED.map((d) => {
                  const has = docs.includes(d);
                  return (
                    <li key={d}>
                      <span className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 body-5 ${has ? "bg-[var(--d-step)]" : "bg-[#fbe4de] text-[var(--d-bad)]"}`}>
                        {has ? <Check className="size-3.5 text-[var(--d-good)]" /> : null}
                        {d}{has ? "" : " missing"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4" aria-live="polite">
                {outcome ? (
                  <p className="flex items-center gap-2 body-5 text-[var(--d-good)]"><Check /> {outcome}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="min-h-10"
                      disabled={missing.length > 0}
                      onClick={() => setDone((d) => ({ ...d, [c.id]: `Verified. ${c.officer} has been emailed and can invite farmers.` }))}
                    >
                      Verify
                    </Button>
                    <Button
                      tone="step"
                      className="min-h-10"
                      onClick={() => setDone((d) => ({ ...d, [c.id]: missing.length ? `Sent back: ${missing.join(", ")} missing.` : "Sent back with your reason." }))}
                    >
                      Send back
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
