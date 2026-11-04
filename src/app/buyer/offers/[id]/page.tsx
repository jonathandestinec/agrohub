import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { OpenThreadButton } from "@/components/messages/open-thread-button";
import { ThreadPanel } from "@/components/messages/thread-panel";
import { BUYER_STATUS_TONE, buyerStatusLabelKey } from "@/components/offers/status";
import { Card, Chip, PageHeading } from "@/components/ui";
import { NotFoundError } from "@/lib/errors";
import { formatNaira } from "@/lib/money";
import { getOwnOffer, type BuyerOffer } from "@/modules/marketplace/service";
import { findBuyerThreadId, getThread } from "@/modules/messaging/service";
import { BuyerOfferActions } from "./counter-response";

export default function BuyerOfferPage({ params }: PageProps<"/buyer/offers/[id]">) {
  return (
    <Suspense fallback={null}>
      <BuyerOfferDetail params={params} />
    </Suspense>
  );
}

async function BuyerOfferDetail({ params }: { params: PageProps<"/buyer/offers/[id]">["params"] }) {
  const actor = await requireActorForPage();
  if (actor.role !== "BUYER") notFound();
  const { id } = await params;
  let offer: BuyerOffer;
  try {
    offer = await getOwnOffer(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const t = await getTranslations("offers");
  const locale = await getLocale();
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
  const threadId = await findBuyerThreadId(actor, offer.lot.id, actor.userId);
  const thread = threadId ? await getThread(actor, threadId) : null;
  const live = offer.status === "WAITING" || offer.status === "COUNTERED";

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading
        title={t("summary", { quantity: offer.quantity, unit: offer.lot.unit, crop: offer.lot.crop })}
        lead={offer.lot.cooperativeName}
      >
        <Chip tone={BUYER_STATUS_TONE[offer.status]}>{t(buyerStatusLabelKey(offer.status))}</Chip>
      </PageHeading>
      <Card tone="paper" className="flex flex-col gap-2">
        <p className="body-4 tabular-nums">
          {t("buyer.yourOffer", { price: formatNaira(offer.offeredKobo), unit: offer.lot.unit })}
        </p>
        {offer.counterKobo !== null ? (
          <p className="body-4 tabular-nums">
            {t("buyer.counter", { price: formatNaira(offer.counterKobo), unit: offer.lot.unit })}
          </p>
        ) : null}
        {offer.agreedKobo !== null ? (
          <p className="body-4 tabular-nums">
            {t("buyer.agreed", { price: formatNaira(offer.agreedKobo), unit: offer.lot.unit })}
          </p>
        ) : null}
        <p className="heading-6 tabular-nums">{t("totalLine", { total: formatNaira(offer.totalKobo) })}</p>
        {live ? <p className="body-6 text-ink-soft">{t("buyer.expires", { time: time.format(new Date(offer.expiresAt)) })}</p> : null}
        {offer.status === "ACCEPTED" && offer.payByAt ? (
          <>
            <p className="body-4">{t("buyer.payBy", { time: time.format(new Date(offer.payByAt)) })}</p>
            <p className="body-6 text-ink-soft">{t("buyer.paymentLater")}</p>
          </>
        ) : null}
        <Link href={`/lots/${offer.lot.id}`} className="body-6 underline underline-offset-2">
          {t("buyer.viewLot")}
        </Link>
      </Card>
      {live ? <BuyerOfferActions offerId={offer.id} countered={offer.status === "COUNTERED"} /> : null}
      <section aria-labelledby="thread-heading" className="flex flex-col gap-3">
        <h2 id="thread-heading" className="heading-6">
          {t("buyer.threadHeading")}
        </h2>
        {thread ? <ThreadPanel thread={thread} /> : <OpenThreadButton lotId={offer.lot.id} label={t("buyer.messageCooperative")} />}
      </section>
    </main>
  );
}
