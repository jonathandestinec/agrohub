import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { OFFICER_STATUS_TONE } from "@/components/offers/status";
import { ArrowUpRight, Chip, PageHeading } from "@/components/ui";
import { formatNaira } from "@/lib/money";
import { listCooperativeOffers } from "@/modules/marketplace/service";

export default function OfficerOffersPage() {
  return (
    <Suspense fallback={null}>
      <OfficerOffers />
    </Suspense>
  );
}

async function OfficerOffers() {
  const actor = await requireActorForPage();
  if (actor.role !== "OFFICER") notFound();
  const t = await getTranslations("offers");
  const locale = await getLocale();
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
  const offers = await listCooperativeOffers(actor);

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("officer.title")} lead={t("officer.lead")} />
      {offers.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("officer.empty")}</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {offers.map((offer) => (
            <li key={offer.id}>
              <Link
                href={`/officer/offers/${offer.id}`}
                className="press press-lift flex min-h-11 flex-col gap-1 rounded-inner bg-paper p-4 hover:bg-step-deep md:p-6"
              >
                <span className="title-2 break-words">
                  {t("summary", { quantity: offer.quantity, unit: offer.unit, crop: offer.crop })}
                </span>
                <span className="body-6 text-ink-soft">{t("officer.from", { buyer: offer.buyerName })}</span>
                <span className="body-5 tabular-nums">
                  {t("officer.priceLine", { price: formatNaira(offer.offeredKobo), unit: offer.unit })}
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <Chip tone={OFFICER_STATUS_TONE[offer.status]}>{t(`officerStatus.${offer.status}`)}</Chip>
                  {offer.belowFloor && offer.status === "OPEN" ? <Chip tone="warn">{t("officer.belowFloor")}</Chip> : null}
                  {offer.status === "OPEN" || offer.status === "AWAITING_FARMER" || offer.status === "COUNTERED" ? (
                    <span className="body-6 text-ink-soft">{t("officer.until", { time: time.format(new Date(offer.expiresAt)) })}</span>
                  ) : null}
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
