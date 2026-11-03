import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { Breakdown } from "@/components/lots/breakdown";
import { LotDetails } from "@/components/lots/lot-details";
import { formatNaira } from "@/lib/money";
import { CounterResponse } from "./counter-response";
import { LOT_STATUS_TONE } from "@/components/lots/status";
import { Card, Chip, PageHeading } from "@/components/ui";
import { NotFoundError } from "@/lib/errors";
import { getOwnLot, type FarmerLot } from "@/modules/catalog/service";

export default function FarmerLotPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <FarmerLotView params={params} />
    </Suspense>
  );
}

async function FarmerLotView({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActorForPage();
  if (actor.role !== "FARMER") notFound();
  const { id } = await params;
  let lot: FarmerLot;
  try {
    lot = await getOwnLot(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const t = await getTranslations("lots");

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("mine.summary", { quantity: lot.quantity, unit: lot.unit.name, crop: lot.crop.name })}>
        <Chip tone={LOT_STATUS_TONE[lot.status]}>{t(`status.${lot.status}`)}</Chip>
      </PageHeading>
      <p role="status" className="rounded-inner bg-paper p-4 body-3 md:p-6">
        {lot.status === "REJECTED" && lot.rejectionReason
          ? t("farmerStatus.REJECTED_WITH_REASON", { reason: lot.rejectionReason })
          : t(`farmerStatus.${lot.status}`)}
      </p>
      {lot.status === "COUNTERED" && lot.counterAskKobo !== null ? (
        <Card tone="paper">
          <section className="flex flex-col gap-4">
            <h2 className="heading-6">
              {t("counter.heading", { price: formatNaira(lot.counterAskKobo), unit: lot.unit.name })}
            </h2>
            {lot.counterMessage ? <p className="body-3">{lot.counterMessage}</p> : null}
            <Breakdown
              askKobo={lot.counterAskKobo}
              quantity={lot.quantity}
              cutBps={lot.quoted.cooperativeCutBps}
              feeBps={lot.quoted.platformFeeBps}
              unit={lot.unit.name}
            />
            <CounterResponse lotId={lot.id} />
          </section>
        </Card>
      ) : null}
      <Card tone="paper">
        <LotDetails lot={lot} />
      </Card>
    </main>
  );
}
