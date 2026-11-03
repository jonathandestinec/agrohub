import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { ButtonLink, Card, Chip, PageHeading } from "@/components/ui";
import { NotFoundError } from "@/lib/errors";
import { formatNaira } from "@/lib/money";
import { getPublicLot, type PublicLot } from "@/modules/catalog/service";

// Public: one live lot at the asking price. Only PublicLot reaches this page, so no floor,
// farmer or screening detail can appear. A lot that is not live is a 404.
async function findLot(id: string): Promise<PublicLot | null> {
  try {
    return await getPublicLot(id);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<"/lots/[id]">): Promise<Metadata> {
  const { id } = await params;
  await connection();
  const lot = await findLot(id);
  if (!lot) return {};
  const t = await getTranslations("publicLot.meta");
  return {
    title: t("title", { quantity: lot.quantity, unit: lot.unit, crop: lot.crop, cooperative: lot.cooperativeName }),
    description: t("description", {
      price: formatNaira(lot.askKobo),
      unit: lot.unit,
      lga: lot.pickupLga,
      state: lot.pickupState,
    }),
    alternates: { canonical: `/lots/${lot.id}` },
  };
}

export default function LotPage({ params }: PageProps<"/lots/[id]">) {
  return (
    <Suspense fallback={null}>
      <LotDetail params={params} />
    </Suspense>
  );
}

async function LotDetail({ params }: { params: PageProps<"/lots/[id]">["params"] }) {
  const { id } = await params;
  await connection();
  const lot = await findLot(id);
  if (!lot) notFound();
  const t = await getTranslations("publicLot");
  const tp = await getTranslations("publicLots");
  const tl = await getTranslations("lots");
  const locale = await getLocale();
  const until = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${lot.availableUntil}T00:00:00Z`),
  );

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading
        title={tl("mine.summary", { quantity: lot.quantity, unit: lot.unit, crop: lot.crop })}
        lead={tl("mine.price", { price: formatNaira(lot.askKobo), unit: lot.unit })}
      />
      {lot.photoUrls.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {lot.photoUrls.map((url, index) => (
            <li key={url}>
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link to a private photo */}
              <img
                src={url}
                alt={t("photoAlt", { crop: lot.crop, number: index + 1 })}
                className="aspect-[4/3] w-full rounded-inner object-cover"
              />
            </li>
          ))}
        </ul>
      ) : null}
      <Card tone="paper" className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Chip tone="lime">{tl(`grade.${lot.grade}`)}</Chip>
          <Chip>{tp("minOrder", { quantity: lot.minOrderQty, unit: lot.unit })}</Chip>
        </div>
        <p className="body-4">{tp("pickup", { lga: lot.pickupLga, state: lot.pickupState })}</p>
        <p className="body-4">{t("availableUntil", { date: until })}</p>
        <p className="body-4">
          {t("soldByPrefix")}{" "}
          <Link href={`/cooperatives/${lot.cooperativeId}`} className="underline underline-offset-2">
            {lot.cooperativeName}
          </Link>
        </p>
        <p className="body-6 text-ink-soft">{t("priceNote")}</p>
      </Card>
      <section aria-labelledby="offer-heading" className="flex flex-col gap-3">
        <h2 id="offer-heading" className="heading-6">
          {t("offerHeading")}
        </h2>
        <p className="body-4 text-ink-soft">{t("held")}</p>
        <div>
          <ButtonLink href="/buyer/join" tone="ink">
            {t("signUpToOffer")}
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}
