import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { LOT_STATUS_TONE } from "@/components/lots/status";
import { ArrowUpRight, ButtonLink, Chip, PageHeading } from "@/components/ui";
import { formatNaira } from "@/lib/money";
import { listOwnLots } from "@/modules/catalog/service";
import { listOffersAwaitingFarmer } from "@/modules/marketplace/service";

export default function MyLotsPage() {
  return (
    <Suspense fallback={null}>
      <MyLots />
    </Suspense>
  );
}

async function MyLots() {
  const actor = await requireActorForPage();
  if (actor.role !== "FARMER") notFound();
  const t = await getTranslations("lots");
  const lots = await listOwnLots(actor);
  const to = await getTranslations("offers");
  const waiting = await listOffersAwaitingFarmer(actor);

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("mine.title")} lead={t("mine.lead")}>
        <ButtonLink href="/farmer/lots/new" tone="ink">
          {t("mine.new")}
        </ButtonLink>
      </PageHeading>
      {waiting.length > 0 ? (
        <section aria-labelledby="waiting-heading" className="flex flex-col gap-2 rounded-inner bg-lime/40 p-4 md:p-6">
          <h2 id="waiting-heading" className="heading-6">
            {to("farmer.waitingHeading")}
          </h2>
          <ul className="flex flex-col gap-2">
            {waiting.map((offer) => (
              <li key={offer.id}>
                <Link href={`/farmer/lots/${offer.lotId}`} className="body-4 underline underline-offset-2">
                  {to("farmer.waitingLine", {
                    quantity: offer.quantity,
                    unit: offer.unit,
                    crop: offer.crop,
                    price: formatNaira(offer.offeredKobo),
                  })}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {lots.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("mine.empty")}</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {lots.map((lot) => (
            <li key={lot.id}>
              <Link
                href={`/farmer/lots/${lot.id}`}
                className="press press-lift flex min-h-11 flex-col gap-1 rounded-inner bg-paper p-4 hover:bg-step-deep md:p-6"
              >
                <span className="title-2 break-words">
                  {t("mine.summary", { quantity: lot.quantity, unit: lot.unit.name, crop: lot.crop.name })}
                </span>
                <span className="body-6 text-ink-soft">
                  {t("mine.price", { price: formatNaira(lot.askKobo), unit: lot.unit.name })}
                </span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <Chip tone={LOT_STATUS_TONE[lot.status]}>{t(`status.${lot.status}`)}</Chip>
                  <ArrowUpRight />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
