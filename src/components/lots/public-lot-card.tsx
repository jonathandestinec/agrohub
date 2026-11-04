import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Chip } from "@/components/ui";
import { formatNaira } from "@/lib/money";
import type { PublicLot } from "@/modules/catalog/service";

// One live lot as buyers see it: only PublicLot fields, so no floor or farmer detail.
export async function PublicLotCard({ lot, showCooperative = true }: { lot: PublicLot; showCooperative?: boolean }) {
  const t = await getTranslations("publicLots");
  const tl = await getTranslations("lots");
  const locale = await getLocale();
  const until = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${lot.availableUntil}T00:00:00Z`),
  );
  return (
    <Link
      href={`/lots/${lot.id}`}
      className="press press-lift flex h-full flex-col overflow-hidden rounded-inner bg-paper hover:bg-step-deep"
    >
      {lot.photoUrls[0] ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link to a private photo
        <img
          src={lot.photoUrls[0]}
          alt={t("photoAlt", { crop: lot.crop })}
          loading="lazy"
          className="aspect-[4/3] w-full object-cover"
        />
      ) : null}
      <span className="flex flex-col gap-2 p-4 md:p-6">
        <span className="title-2 break-words">
          {tl("mine.summary", { quantity: lot.quantity, unit: lot.unit, crop: lot.crop })}
        </span>
        <span className="heading-6 tabular-nums">{tl("mine.price", { price: formatNaira(lot.askKobo), unit: lot.unit })}</span>
        <span className="flex flex-wrap gap-2">
          <Chip tone="lime">{tl(`grade.${lot.grade}`)}</Chip>
          <Chip>{t("minOrder", { quantity: lot.minOrderQty, unit: lot.unit })}</Chip>
        </span>
        <span className="body-6 text-ink-soft">
          {t("pickup", { lga: lot.pickupLga, state: lot.pickupState })} · {t("until", { date: until })}
        </span>
        {showCooperative ? <span className="body-6">{t("soldBy", { cooperative: lot.cooperativeName })}</span> : null}
      </span>
    </Link>
  );
}
