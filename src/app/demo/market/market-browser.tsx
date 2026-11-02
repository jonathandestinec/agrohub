"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatNaira } from "@/lib/money";
import { ArrowUpRight, Check, CropPhoto } from "../_components/ui";
import { CROPS, LOTS, cooperativeById, cropById } from "../_lib/data";

const STATES = Array.from(new Set(LOTS.map((l) => cooperativeById(l.cooperativeId).state))).sort();

export function MarketBrowser() {
  const [crop, setCrop] = useState("all");
  const [state, setState] = useState("all");
  const [grade, setGrade] = useState("all");

  const lots = useMemo(
    () =>
      LOTS.filter(
        (l) =>
          (crop === "all" || l.cropId === crop) &&
          (state === "all" || cooperativeById(l.cooperativeId).state === state) &&
          (grade === "all" || l.grade === grade),
      ),
    [crop, state, grade],
  );

  return (
    <>
      <div className="mt-8 flex flex-col gap-3" role="group" aria-label="Filter lots">
        <FilterRow label="Crop" value={crop} onChange={setCrop} options={[{ v: "all", l: "All crops" }, ...CROPS.filter((c) => LOTS.some((l) => l.cropId === c.id)).map((c) => ({ v: c.id, l: c.name }))]} />
        <div className="flex flex-wrap gap-3">
          <FilterRow label="State" value={state} onChange={setState} options={[{ v: "all", l: "All states" }, ...STATES.map((s) => ({ v: s, l: s }))]} />
          <FilterRow label="Grade" value={grade} onChange={setGrade} options={[{ v: "all", l: "Any grade" }, { v: "Grade A", l: "Grade A" }, { v: "Grade B", l: "Grade B" }]} />
        </div>
      </div>

      <p className="mt-6 body-6 text-[var(--d-ink-2)]" aria-live="polite">
        {lots.length === 1 ? "1 lot" : `${lots.length} lots`} from verified cooperatives
      </p>

      {lots.length === 0 ? (
        <div className="mt-4 flex flex-col items-start gap-4 rounded-3xl bg-[var(--d-step)] p-8">
          <p className="heading-6">No lots match these filters</p>
          <p className="body-3 text-[var(--d-ink-2)]">Try another state or grade. New lots appear as soon as an officer approves them.</p>
          <button
            type="button"
            onClick={() => { setCrop("all"); setState("all"); setGrade("all"); }}
            className="press min-h-11 rounded-full bg-[var(--d-ink)] px-5 button-sm text-white"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lots.map((lot) => {
            const c = cropById(lot.cropId);
            const coop = cooperativeById(lot.cooperativeId);
            return (
              <li key={lot.id}>
                <Link
                  href={`/demo/market/${lot.id}`}
                  className="press press-lift group flex h-full flex-col overflow-hidden rounded-3xl bg-[var(--d-step)] p-2 hover:bg-[var(--d-step-2)]"
                >
                  <CropPhoto crop={c} sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 90vw" className="flex h-52 items-end rounded-2xl p-4">
                    <span className="heading-4">{c.name}</span>
                    <span className="absolute right-3 top-3 flex size-10 items-center justify-center rounded-full bg-white/85 text-[var(--d-ink)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:rotate-45">
                      <ArrowUpRight />
                    </span>
                    <span className="absolute left-3 top-3 rounded-full bg-white/85 px-3 py-1 caption-4 text-[var(--d-ink)]">{lot.grade}</span>
                  </CropPhoto>
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="heading-6">{formatNaira(lot.askKobo)}</span>
                      <span className="body-6 text-[var(--d-ink-2)]">per {c.unit}</span>
                    </div>
                    <p className="body-6 text-[var(--d-ink-2)]">
                      {lot.quantity} available · minimum order {lot.minOrder}
                    </p>
                    <p className="mt-auto flex items-center gap-1.5 body-5">
                      <Check className="size-4 shrink-0 text-[var(--d-good)]" />
                      <span className="truncate">{coop.name}</span>
                    </p>
                    <p className="-mt-2 pl-5.5 caption-4 text-[var(--d-ink-2)]">{coop.lga}, {coop.state}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function FilterRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.v)}
            className={`press min-h-11 rounded-full px-4 title-4 outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--d-ink)] ${
              on ? "bg-[var(--d-ink)] text-white" : "bg-[var(--d-step)] hover:bg-[var(--d-step-2)]"
            }`}
          >
            {o.l}
          </button>
        );
      })}
    </fieldset>
  );
}
