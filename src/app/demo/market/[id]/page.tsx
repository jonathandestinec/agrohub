import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { formatNaira } from "@/lib/money";
import { ArrowRight, Check, Chip, CropPhoto } from "../../_components/ui";
import { LOTS, cooperativeById, cropById, lotById } from "../../_lib/data";
import { BuyBox } from "./buy-box";

export function generateStaticParams() {
  return LOTS.map((l) => ({ id: l.id }));
}

export default function LotPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="m-6 h-[600px] animate-pulse rounded-3xl bg-[var(--d-step)]" />}>
      <Lot params={params} />
    </Suspense>
  );
}

async function Lot({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lot = lotById(id);
  if (!lot) notFound();
  const crop = cropById(lot.cropId);
  const coop = cooperativeById(lot.cooperativeId);
  const diff = lot.askKobo - lot.boardKobo;

  return (
    <div className="px-2 pt-6 md:px-6 md:pt-10">
      <Link href="/demo/market" className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--d-step)] px-4 title-4 hover:bg-[var(--d-step-2)]">
        <ArrowRight className="size-4 rotate-180" /> All harvests
      </Link>

      <div className="mt-6 grid gap-3 lg:grid-cols-12">
        <div className="flex flex-col gap-3 lg:col-span-8">
          <CropPhoto crop={crop} priority sizes="(min-width: 1024px) 64vw, 100vw" className="flex min-h-80 flex-col justify-between rounded-3xl p-6 md:min-h-[460px] md:p-8">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-white/85 px-3 py-1 caption-4 text-[var(--d-ink)]">{lot.grade}</span>
              <span className="rounded-full bg-white/85 px-3 py-1 caption-4 text-[var(--d-ink)]">Harvested {lot.harvested}</span>
            </div>
            <h1 className="heading-1">{crop.name}</h1>
          </CropPhoto>

          <section aria-labelledby="details" className="rounded-3xl bg-[var(--d-step)] p-6 md:p-8">
            <h2 id="details" className="heading-6">About this lot</h2>
            <p className="mt-3 max-w-[60ch] body-3">{lot.note}</p>
            <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ["Quantity", `${lot.quantity} ${crop.unit}s`],
                ["Minimum order", `${lot.minOrder} ${crop.unit}s`],
                ["Farmers in this lot", String(lot.farmers)],
                ["Pickup", `${coop.lga}, ${coop.state}`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-[var(--d-paper)] p-4">
                  <dt className="caption-2 text-[var(--d-ink-2)]">{k}</dt>
                  <dd className="mt-1 title-3">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 body-6 text-[var(--d-ink-2)]">
              Board price this week: {formatNaira(lot.boardKobo)} per {crop.unit}.{" "}
              {diff === 0 ? "This lot matches it." : `This lot is ${formatNaira(Math.abs(diff))} ${diff > 0 ? "above" : "below"} it.`}
            </p>
          </section>

          <section aria-labelledby="coop" className="flex flex-col gap-4 rounded-3xl bg-[var(--d-forest)] p-6 text-[var(--d-forest-ink)] md:flex-row md:items-center md:justify-between md:p-8">
            <div>
              <h2 id="coop" className="heading-5">{coop.name}</h2>
              <p className="mt-2 body-6 opacity-80">{coop.members} members · {coop.lga}, {coop.state}</p>
            </div>
            <Chip tone="lime"><Check className="size-3.5" /> Verified by AgroHub on {coop.verifiedOn}</Chip>
          </section>
        </div>

        <aside className="lg:col-span-4">
          <div className="lg:sticky lg:top-4">
            <BuyBox lotId={lot.id} unit={crop.unit} askKobo={lot.askKobo} available={lot.quantity} minOrder={lot.minOrder} cooperative={coop.name} />
            <p className="mt-3 px-2 caption-2 text-[var(--d-ink-2)]">
              You deal with the cooperative, never an individual farmer. Payment is held until you confirm delivery.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
