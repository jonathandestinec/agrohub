import type { Metadata } from "next";
import Link from "next/link";
import { formatNaira } from "@/lib/money";
import { EarningsCalculator } from "../_components/earnings-calculator";
import { ArrowUpRight, Chip, CropThumb, PageHeading } from "../_components/ui";
import { DEMO_FARMER, cooperativeById, cropById, lotById } from "../_lib/data";
import { SubmitLot } from "./submit-lot";

export const metadata: Metadata = { title: "Farmer" };

const PAST_LOTS: Record<string, { cropId: string; askKobo: number }> = {
  "lot-1066": { cropId: "maize", askKobo: 6_550_000 },
  "lot-0987": { cropId: "maize", askKobo: 6_210_000 },
};

export default function FarmerPage() {
  const coop = cooperativeById(DEMO_FARMER.cooperativeId);
  return (
    <div className="px-2 pt-8 md:px-6 md:pt-12">
      <PageHeading title={`Welcome back, ${DEMO_FARMER.name.split(" ")[0]}`} lead={`Member of ${coop.name} · ${DEMO_FARMER.farmSize}`}>
        <Chip tone="forest">Approved member</Chip>
      </PageHeading>

      <section aria-label="Your money" className="mt-8 grid gap-3 md:grid-cols-3">
        <div className="rounded-3xl bg-[var(--d-forest)] p-6 text-[var(--d-forest-ink)]">
          <p className="body-5 opacity-80">Paid to your bank</p>
          <p className="mt-2 heading-4">{formatNaira(DEMO_FARMER.paidOutKobo)}</p>
          <p className="mt-1 caption-2 opacity-80">Since joining in June 2026</p>
        </div>
        <div className="rounded-3xl bg-[var(--d-lime)] p-6 text-[var(--d-lime-ink)]">
          <p className="body-5">Held until delivery is confirmed</p>
          <p className="mt-2 heading-4">{formatNaira(DEMO_FARMER.heldKobo)}</p>
          <p className="mt-1 caption-2">Your 30 bags in order ord-2209, due 4 Nov</p>
        </div>
        <div className="rounded-3xl bg-[var(--d-step)] p-6">
          <p className="body-5 text-[var(--d-ink-2)]">Lots this season</p>
          <p className="mt-2 heading-4">{DEMO_FARMER.lots.length}</p>
          <p className="mt-1 caption-2 text-[var(--d-ink-2)]">One waiting for your officer</p>
        </div>
      </section>

      <section aria-labelledby="lots" className="mt-16">
        <h2 id="lots" className="heading-5">Your lots</h2>
        <ul className="mt-4 flex flex-col gap-2">
          {DEMO_FARMER.lots.map((l) => {
            const live = lotById(l.id);
            const info = live ?? PAST_LOTS[l.id]!;
            const crop = cropById(info.cropId);
            const tone = l.status === "Live" ? "lime" : l.status === "Sold and paid" ? "forest" : "warn";
            const row = (
              <>
                <CropThumb crop={crop} className="size-12" />
                <span className="flex-1">
                  <span className="block title-3">{crop.name} · {l.contributed} {crop.unit}s</span>
                  <span className="block caption-2 text-[var(--d-ink-2)]">{l.id} · {formatNaira(info.askKobo)} per {crop.unit}</span>
                </span>
                <Chip tone={tone}>{l.status}</Chip>
              </>
            );
            return (
              <li key={l.id}>
                {live ? (
                  <Link href={`/demo/market/${l.id}`} className="press flex min-h-16 items-center gap-4 rounded-3xl bg-[var(--d-step)] p-3 pr-5 hover:bg-[var(--d-step-2)]">
                    {row}
                    <ArrowUpRight />
                  </Link>
                ) : (
                  <div className="flex min-h-16 items-center gap-4 rounded-3xl bg-[var(--d-step)] p-3 pr-5">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="new" className="mt-16">
        <h2 id="new" className="heading-5">List a new harvest</h2>
        <p className="mt-2 max-w-[60ch] body-3 text-[var(--d-ink-2)]">
          Check what you take home first. Your officer approves the lot before buyers can see it.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <EarningsCalculator tone="paper" />
          <SubmitLot />
        </div>
      </section>
    </div>
  );
}
