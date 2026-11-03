import { getLocale, getTranslations } from "next-intl/server";
import { Breakdown } from "@/components/lots/breakdown";
import { formatNaira } from "@/lib/money";
import type { FarmerLot } from "@/modules/catalog/views";

// The facts of a lot for its farmer and its screening officer, the private floor included.
// Never render this on a buyer-facing page: buyers get PublicLot only.
export async function LotDetails({ lot }: { lot: FarmerLot }) {
  const t = await getTranslations("lots");
  const locale = await getLocale();
  const date = (key: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
  const terms = lot.lockedTerms ?? lot.quoted;
  const facts: Array<[string, string]> = [
    [t("details.quantity"), `${lot.quantity} × ${lot.unit.name}`],
    [t("details.grade"), t(`grade.${lot.grade}`)],
    [t("details.ask"), t("mine.price", { price: formatNaira(lot.askKobo), unit: lot.unit.name })],
    [t("details.floor"), formatNaira(lot.floorKobo)],
    [t("details.pickup"), [lot.pickupLga, lot.pickupState].join(", ") + (lot.pickupNote ? ` · ${lot.pickupNote}` : "")],
    [t("details.availableUntil"), date(lot.availableUntil)],
    [t("details.minOrder"), `${lot.minOrderQty} × ${lot.unit.name}`],
  ];

  return (
    <div className="flex flex-col gap-4">
      {lot.photoUrls.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {lot.photoUrls.map((url, i) => (
            <li key={url}>
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link to a private photo */}
              <img
                src={url}
                alt={t("details.photoAlt", { n: i + 1, crop: lot.crop.name })}
                loading="lazy"
                className="aspect-square w-full rounded-inner object-cover"
              />
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="body-6 text-ink-soft">{label}</dt>
            <dd className="title-4 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {lot.note ? (
        <p className="rounded-inner bg-step p-4 body-3">
          <span className="title-4">{t("details.note")}</span> {lot.note}
        </p>
      ) : null}
      {lot.deviation === "HIGH" || lot.deviation === "LOW" ? (
        <p className="body-6 text-ink-soft">{t(`details.deviation.${lot.deviation}`)}</p>
      ) : null}
      <section className="flex flex-col gap-2">
        <h2 className="title-3">{lot.lockedTerms ? t("details.lockedTerms") : t("details.quotedTerms")}</h2>
        <Breakdown
          askKobo={lot.askKobo}
          quantity={lot.quantity}
          cutBps={terms.cooperativeCutBps}
          feeBps={terms.platformFeeBps}
          unit={lot.unit.name}
        />
      </section>
    </div>
  );
}
