import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { ThreadPanel } from "@/components/messages/thread-panel";
import { OFFICER_STATUS_TONE } from "@/components/offers/status";
import { Card, Chip, PageHeading } from "@/components/ui";
import { NotFoundError } from "@/lib/errors";
import { formatNaira, lineTotalKobo } from "@/lib/money";
import { getCooperativeOffer, type OfficerOffer } from "@/modules/marketplace/service";
import { findBuyerThreadId, getThread } from "@/modules/messaging/service";
import { OfficerOfferActions } from "./offer-actions";

export default function OfficerOfferPage({ params }: PageProps<"/officer/offers/[id]">) {
  return (
    <Suspense fallback={null}>
      <OfficerOfferDetail params={params} />
    </Suspense>
  );
}

async function OfficerOfferDetail({ params }: { params: PageProps<"/officer/offers/[id]">["params"] }) {
  const actor = await requireActorForPage();
  if (actor.role !== "OFFICER") notFound();
  const { id } = await params;
  let offer: OfficerOffer;
  try {
    offer = await getCooperativeOffer(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const t = await getTranslations("offers");
  const locale = await getLocale();
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
  const buyerUserThread = await findOfferThread(actor, offer);
  const per = (kobo: number) => t("officer.priceLine", { price: formatNaira(kobo), unit: offer.unit });

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading
        title={t("summary", { quantity: offer.quantity, unit: offer.unit, crop: offer.crop })}
        lead={t("officer.from", { buyer: offer.buyerName })}
      >
        <Chip tone={OFFICER_STATUS_TONE[offer.status]}>{t(`officerStatus.${offer.status}`)}</Chip>
      </PageHeading>
      <Card tone="paper" className="flex flex-col gap-2">
        <p className="body-4 tabular-nums">{t("officer.offered", { price: per(offer.offeredKobo) })}</p>
        <p className="body-4 tabular-nums">{t("officer.ask", { price: per(offer.askKobo) })}</p>
        <p className="body-4 tabular-nums">{t("officer.floor", { price: per(offer.floorKobo) })}</p>
        {offer.counterKobo !== null ? (
          <p className="body-4 tabular-nums">{t("officer.countered", { price: per(offer.counterKobo) })}</p>
        ) : null}
        {offer.agreedKobo !== null ? (
          <p className="body-4 tabular-nums">{t("officer.agreed", { price: per(offer.agreedKobo) })}</p>
        ) : null}
        <p className="heading-6 tabular-nums">
          {t("totalLine", {
            total: formatNaira(lineTotalKobo(offer.agreedKobo ?? offer.counterKobo ?? offer.offeredKobo, offer.quantity)),
          })}
        </p>
        {offer.status === "OPEN" || offer.status === "COUNTERED" || offer.status === "AWAITING_FARMER" ? (
          <p className="body-6 text-ink-soft">{t("officer.until", { time: time.format(new Date(offer.expiresAt)) })}</p>
        ) : null}
        {offer.status === "AWAITING_FARMER" ? <p className="body-5">{t("officer.withFarmer")}</p> : null}
        <Link href={`/officer/lots/${offer.lotId}`} className="body-6 underline underline-offset-2">
          {t("officer.viewLot")}
        </Link>
      </Card>
      {offer.status === "OPEN" ? <OfficerOfferActions offerId={offer.id} belowFloor={offer.belowFloor} /> : null}
      <section aria-labelledby="thread-heading" className="flex flex-col gap-3">
        <h2 id="thread-heading" className="heading-6">
          {t("officer.threadHeading")}
        </h2>
        {buyerUserThread ? <ThreadPanel thread={buyerUserThread} /> : <p className="body-4 text-ink-soft">{t("officer.noThread")}</p>}
      </section>
    </main>
  );
}

// The buyer thread for this offer's lot and buyer, if the buyer has written or an answer carried
// a message.
async function findOfferThread(actor: Parameters<typeof getThread>[0], offer: OfficerOffer) {
  const threadId = await findBuyerThreadId(actor, offer.lotId, offer.buyerUserId);
  return threadId ? getThread(actor, threadId) : null;
}
