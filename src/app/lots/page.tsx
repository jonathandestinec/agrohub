import { connection } from "next/server";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { Chip, PageHeading } from "@/components/ui";
import { formatNaira } from "@/lib/money";
import { listLiveLots } from "@/modules/catalog/service";

// Public: buyers and signed-out visitors see live lots at the asking price. Only PublicLot
// reaches this page, so no floor, farmer or screening detail can appear here. Offers and
// filters arrive in Phase 4.
export default function LotsPage() {
  return (
    <Suspense fallback={null}>
      <Lots />
    </Suspense>
  );
}

async function Lots() {
  const t = await getTranslations("publicLots");
  const tl = await getTranslations("lots");
  const locale = await getLocale();
  // Rendered per request: a lot hides itself once its available-until day has passed.
  await connection();
  const lots = await listLiveLots();
  const date = (key: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")} />
      {lots.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("empty")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {lots.map((lot) => (
            <li key={lot.id} className="flex flex-col overflow-hidden rounded-inner bg-paper">
              {lot.photoUrls[0] ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link to a private photo
                <img
                  src={lot.photoUrls[0]}
                  alt={t("photoAlt", { crop: lot.crop })}
                  loading="lazy"
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : null}
              <div className="flex flex-col gap-2 p-4 md:p-6">
                <h2 className="title-2 break-words">
                  {tl("mine.summary", { quantity: lot.quantity, unit: lot.unit, crop: lot.crop })}
                </h2>
                <p className="heading-6 tabular-nums">{tl("mine.price", { price: formatNaira(lot.askKobo), unit: lot.unit })}</p>
                <div className="flex flex-wrap gap-2">
                  <Chip tone="lime">{tl(`grade.${lot.grade}`)}</Chip>
                  <Chip>{t("minOrder", { quantity: lot.minOrderQty, unit: lot.unit })}</Chip>
                </div>
                <p className="body-6 text-ink-soft">
                  {t("pickup", { lga: lot.pickupLga, state: lot.pickupState })} · {t("until", { date: date(lot.availableUntil) })}
                </p>
                <p className="body-6">{t("soldBy", { cooperative: lot.cooperativeName })}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
