import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { BUYER_STATUS_TONE, buyerStatusLabelKey } from "@/components/offers/status";
import { ArrowUpRight, ButtonLink, Chip, PageHeading } from "@/components/ui";
import { formatNaira } from "@/lib/money";
import { listOwnOffers } from "@/modules/marketplace/service";

export default function BuyerHomePage() {
  return (
    <Suspense fallback={null}>
      <BuyerHome />
    </Suspense>
  );
}

async function BuyerHome() {
  const actor = await requireActorForPage();
  if (actor.role !== "BUYER") notFound();
  const t = await getTranslations("buyer.home");
  const to = await getTranslations("offers");
  const offers = await listOwnOffers(actor);

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")}>
        <ButtonLink href="/lots" tone="ink">
          {t("browse")}
        </ButtonLink>
      </PageHeading>
      {offers.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("empty")}</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {offers.map((offer) => (
            <li key={offer.id}>
              <Link
                href={`/buyer/offers/${offer.id}`}
                className="press press-lift flex min-h-11 flex-col gap-1 rounded-inner bg-paper p-4 hover:bg-step-deep md:p-6"
              >
                <span className="title-2 break-words">
                  {to("summary", { quantity: offer.quantity, unit: offer.lot.unit, crop: offer.lot.crop })}
                </span>
                <span className="body-6 text-ink-soft">{offer.lot.cooperativeName}</span>
                <span className="body-5 tabular-nums">{to("totalLine", { total: formatNaira(offer.totalKobo) })}</span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <Chip tone={BUYER_STATUS_TONE[offer.status]}>{to(buyerStatusLabelKey(offer.status))}</Chip>
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
