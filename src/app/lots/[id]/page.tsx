import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { OpenThreadButton } from "@/components/messages/open-thread-button";
import { CheckoutForm } from "@/components/orders/checkout-form";
import { ButtonLink, Card, Chip, PageHeading } from "@/components/ui";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { formatNaira } from "@/lib/money";
import { availableQuantity, getPublicLot, type PublicLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { listMemberships } from "@/modules/identity/service";
import { currentUser, getActor } from "@/modules/identity/session";
import { listUsableQuotes } from "@/modules/orders/service";
import { OfferForm } from "./offer-form";

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

// Who is looking: an active buyer gets the offer form; a signed-in user holding a buyer
// membership under another active role is told to switch; anyone else is pointed to sign-up.
async function viewer(): Promise<{ actor: Actor | null; hasBuyerRole: boolean }> {
  let actor: Actor | null = null;
  try {
    actor = await getActor();
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
  }
  if (actor?.role === "BUYER") return { actor, hasBuyerRole: true };
  const user = await currentUser();
  const memberships = user ? await listMemberships(user.userId) : [];
  return { actor, hasBuyerRole: memberships.some((m) => m.role === "BUYER") };
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
        <OfferSlot lot={lot} />
      </section>
    </main>
  );
}

async function OfferSlot({ lot }: { lot: PublicLot }) {
  const t = await getTranslations("publicLot");
  const { actor, hasBuyerRole } = await viewer();
  if (actor?.role === "BUYER") {
    return (
      <>
        <BuyNow lot={lot} actor={actor} />
        <OfferForm
          lotId={lot.id}
          askKobo={lot.askKobo}
          minOrderQty={lot.minOrderQty}
          quantity={lot.quantity}
          unit={lot.unit}
        />
        <OpenThreadButton lotId={lot.id} label={t("messageCooperative")} />
      </>
    );
  }
  if (hasBuyerRole) return <p className="body-4">{t("switchToBuyer")}</p>;
  return (
    <div>
      <ButtonLink href="/buyer/join" tone="ink">
        {t("signUpToOffer")}
      </ButtonLink>
    </div>
  );
}

// An active buyer buys at the asking price: as much as is free now, pickup or a delivery quote
// the cooperative sent them.
async function BuyNow({ lot, actor }: { lot: PublicLot; actor: Actor }) {
  const t = await getTranslations("orders");
  const locale = await getLocale();
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
  const available = await availableQuantity(lot.id);
  const quotes = await listUsableQuotes(actor, lot.id);
  return (
    <section aria-labelledby="buy-heading" className="flex flex-col gap-2">
      <h3 id="buy-heading" className="title-2">
        {t("checkout.heading")}
      </h3>
      <p className="body-4">{t("checkout.available", { quantity: available, unit: lot.unit })}</p>
      {available >= lot.minOrderQty ? (
        <CheckoutForm
          source="LOT"
          lotId={lot.id}
          unitKobo={lot.askKobo}
          unit={lot.unit}
          minQuantity={lot.minOrderQty}
          maxQuantity={available}
          pickupLabel={t("checkout.pickup", { lga: lot.pickupLga, state: lot.pickupState })}
          quotes={quotes.map((q) => ({ id: q.id, amountKobo: q.amountKobo, until: time.format(new Date(q.expiresAt)) }))}
        />
      ) : null}
    </section>
  );
}
