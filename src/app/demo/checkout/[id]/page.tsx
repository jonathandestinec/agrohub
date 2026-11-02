import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowRight, PageHeading } from "../../_components/ui";
import { LOTS, cooperativeById, cropById, lotById } from "../../_lib/data";
import { Checkout } from "./checkout";

export function generateStaticParams() {
  return LOTS.map((l) => ({ id: l.id }));
}

export default function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="px-2 pt-6 md:px-6 md:pt-10">
      <Suspense fallback={<div className="h-[560px] animate-pulse rounded-3xl bg-[var(--d-step)]" />}>
        <CheckoutForLot params={params} />
      </Suspense>
    </div>
  );
}

async function CheckoutForLot({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lot = lotById(id);
  if (!lot) notFound();
  const crop = cropById(lot.cropId);
  return (
    <>
      <Link href={`/demo/market/${lot.id}`} className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--d-step)] px-4 title-4 hover:bg-[var(--d-step-2)]">
        <ArrowRight className="size-4 rotate-180" /> Back to the lot
      </Link>
      <div className="mt-6">
        <PageHeading title="Checkout" lead="Paystack test mode. No real card is charged in this demo." />
      </div>
      <Checkout
        lotId={lot.id}
        cropName={crop.name}
        unit={crop.unit}
        askKobo={lot.askKobo}
        minOrder={lot.minOrder}
        available={lot.quantity}
        cooperative={cooperativeById(lot.cooperativeId).name}
        farmers={lot.farmers}
      />
    </>
  );
}
