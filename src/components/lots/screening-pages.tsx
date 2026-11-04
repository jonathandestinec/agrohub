import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { LotDetails } from "@/components/lots/lot-details";
import { RevisionDecision } from "@/components/lots/revision-decision";
import { ScreeningActions } from "@/components/lots/screening-actions";
import { LOT_STATUS_TONE } from "@/components/lots/status";
import { ArrowUpRight, Card, Chip, PageHeading } from "@/components/ui";
import { NotFoundError } from "@/lib/errors";
import { formatNaira } from "@/lib/money";
import { getLotForScreening, listScreeningQueue } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";

// The screening queue and one lot's screening page, shared by officers (/officer/lots) and
// admins screening for cooperatives with no other officer (/admin/lots).

export async function ScreeningQueue({ actor, basePath }: { actor: Actor; basePath: string }) {
  const t = await getTranslations("lots");
  const lots = await listScreeningQueue(actor);
  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading
        title={t(actor.role === "ADMIN" ? "screening.adminTitle" : "screening.title")}
        lead={t(actor.role === "ADMIN" ? "screening.adminLead" : "screening.lead")}
      />
      {lots.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("screening.empty")}</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {lots.map((lot) => (
            <li key={lot.id}>
              <Link
                href={`${basePath}/${lot.id}`}
                className="press press-lift flex min-h-11 flex-col gap-1 rounded-inner bg-paper p-4 hover:bg-step-deep md:p-6"
              >
                <span className="title-2 break-words">
                  {t("mine.summary", { quantity: lot.quantity, unit: lot.unit.name, crop: lot.crop.name })}
                </span>
                <span className="body-6 text-ink-soft">
                  {t("screening.from", { name: lot.farmerName })} ·{" "}
                  {t("mine.price", { price: formatNaira(lot.askKobo), unit: lot.unit.name })}
                </span>
                <span className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap gap-2">
                    <Chip tone={LOT_STATUS_TONE[lot.status]}>{t(`status.${lot.status}`)}</Chip>
                    {lot.canApprove ? null : <Chip tone="paper">{t("screening.yours")}</Chip>}
                  </span>
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

// extra: anything a role adds below the screening actions (the officer's farmer-thread link).
export async function ScreeningLotPage({ actor, lotId, extra }: { actor: Actor; lotId: string; extra?: ReactNode }) {
  let lot: Awaited<ReturnType<typeof getLotForScreening>>;
  try {
    lot = await getLotForScreening(actor, lotId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const t = await getTranslations("lots");
  const locale = await getLocale();
  const week = (key: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading
        title={t("mine.summary", { quantity: lot.quantity, unit: lot.unit.name, crop: lot.crop.name })}
        lead={t("screening.from", { name: lot.farmerName })}
      >
        <Chip tone={LOT_STATUS_TONE[lot.status]}>{t(`status.${lot.status}`)}</Chip>
      </PageHeading>
      <div className="grid gap-2 md:grid-cols-12">
        <Card tone="paper" className="md:col-span-7">
          <LotDetails lot={lot} />
        </Card>
        <div className="flex flex-col gap-2 md:col-span-5">
          <Card tone="paper">
            <section className="flex flex-col gap-2">
              <h2 className="heading-6">{t("screening.board")}</h2>
              {lot.boardPrices.length === 0 ? (
                <p className="body-6 text-ink-soft">{t("screening.noBoard")}</p>
              ) : (
                <ul className="body-6">
                  {lot.boardPrices.map((b) => (
                    <li key={b.market}>
                      {t("form.boardPrice", { market: b.market, price: formatNaira(b.priceKobo), week: week(b.weekOf) })}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </Card>
          {lot.pendingRevision ? (
            <Card tone="paper">
              <section className="flex flex-col gap-3">
                <h2 className="heading-6">{t("revision.heading")}</h2>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 body-3">
                  <dt className="text-ink-soft">{t("details.ask")}</dt>
                  <dd>
                    {formatNaira(lot.askKobo)} → {formatNaira(lot.pendingRevision.askKobo)}
                  </dd>
                  <dt className="text-ink-soft">{t("details.quantity")}</dt>
                  <dd>
                    {lot.quantity} → {lot.pendingRevision.quantity}
                  </dd>
                  <dt className="text-ink-soft">{t("details.floor")}</dt>
                  <dd>
                    {formatNaira(lot.floorKobo)} → {formatNaira(lot.pendingRevision.floorKobo)}
                  </dd>
                </dl>
                {lot.pendingRevision.note ? <p className="body-3">{lot.pendingRevision.note}</p> : null}
                {lot.canApprove ? (
                  <RevisionDecision lotId={lot.id} revisionId={lot.pendingRevision.id} />
                ) : (
                  <p className="body-6 text-ink-soft">{t("screening.ownLot")}</p>
                )}
              </section>
            </Card>
          ) : null}
          <Card tone="paper">
            {lot.status === "PENDING_REVIEW" && lot.canApprove ? (
              <ScreeningActions lotId={lot.id} quantity={lot.quantity} unit={lot.unit.name} />
            ) : (
              <p role="status" className="body-3">
                {lot.status === "PENDING_REVIEW"
                  ? t("screening.ownLot")
                  : lot.status === "COUNTERED"
                    ? t("screening.waitingOnFarmer", { price: formatNaira(lot.counterAskKobo ?? 0) })
                    : t(`status.${lot.status}`)}
              </p>
            )}
          </Card>
        </div>
      </div>
      {extra}
    </main>
  );
}
