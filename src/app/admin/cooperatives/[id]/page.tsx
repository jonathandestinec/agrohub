import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { ArrowUpRight, Card, PageHeading } from "@/components/ui";
import { NotFoundError } from "@/lib/errors";
import { getCooperativeBankAccount } from "@/modules/banking/service";
import { formatEffectiveAt } from "@/modules/banking/views";
import { cooperativeCancellations } from "@/modules/orders/service";
import { DOCUMENT_KINDS } from "@/modules/cooperatives/schema";
import {
  getCooperativeForReview,
  getDocumentUrl,
} from "@/modules/cooperatives/service";
import type { AdminCooperative } from "@/modules/cooperatives/views";
import { ReviewActions } from "./review-actions";

export default function CooperativeReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <Review params={params} />
    </Suspense>
  );
}

async function Review({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActorForPage();
  if (actor.role !== "ADMIN") notFound();
  const { id } = await params;
  let cooperative: AdminCooperative;
  try {
    cooperative = await getCooperativeForReview(actor, id, new Date());
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const t = await getTranslations("admin.cooperatives");
  const kinds = await getTranslations("officer.onboarding.kinds");
  const locale = await getLocale();
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(iso),
    );

  // Signed links are short-lived, so they are made on every request.
  const documents = await Promise.all(
    DOCUMENT_KINDS.map(async (kind) => {
      const doc = cooperative.documents.find((d) => d.kind === kind);
      return {
        kind,
        url: doc ? await getDocumentUrl(actor, doc.id) : null,
      };
    }),
  );

  const rows: Array<[string, string]> = [
    [t("detail.registrationNumber"), cooperative.registrationNumber],
    [t("detail.location"), `${cooperative.lga}, ${cooperative.state}`],
    [t("detail.status"), t(`state.${cooperative.status}`)],
    [
      t("detail.certificateExpiresAt"),
      formatDate(cooperative.certificateExpiresAt),
    ],
    [
      t("detail.submittedAt"),
      cooperative.submittedAt
        ? formatDate(cooperative.submittedAt)
        : t("detail.notSubmitted"),
    ],
  ];
  if (cooperative.verifiedAt) {
    rows.push([t("detail.verifiedAt"), formatDate(cooperative.verifiedAt)]);
  }
  if (cooperative.reviewNote) {
    rows.push([t("detail.reviewNote"), cooperative.reviewNote]);
  }
  // Bank and account name only; the recipient code never leaves the server.
  const payout = await getCooperativeBankAccount(actor, cooperative.id, new Date());
  const cancellations = await cooperativeCancellations(actor, cooperative.id);

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <Link
        href="/admin/cooperatives"
        className="inline-flex min-h-11 items-center gap-2 self-start title-4 underline underline-offset-2"
      >
        {t("back")}
      </Link>
      <PageHeading title={cooperative.name} lead={t("cancellations", { count: cancellations })} />
      <div className="grid gap-2 md:grid-cols-12">
        <div className="flex flex-col gap-2 md:col-span-8">
          <Card tone="paper">
            <dl className="grid gap-4 sm:grid-cols-2">
              {rows.map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="body-6 text-ink-soft">{label}</dt>
                  <dd className="title-3 break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card tone="paper">
            <section className="flex flex-col gap-2">
              <h2 className="heading-6">{t("detail.payoutHeading")}</h2>
              <p className="title-3 break-words">
                {payout.accountName
                  ? t("detail.payoutCurrent", {
                      accountName: payout.accountName,
                      bankName: payout.bankName ?? "",
                    })
                  : t("detail.payoutNone")}
              </p>
              {payout.change?.state === "AWAITING_CONFIRMATION" ? (
                <p className="body-6 text-ink-soft">{t("detail.payoutAwaiting")}</p>
              ) : null}
              {payout.change?.state === "CONFIRMED" ? (
                <p className="body-6 text-ink-soft">
                  {t("detail.payoutConfirmed", {
                    date: formatEffectiveAt(payout.change.effectiveAt, locale),
                  })}
                </p>
              ) : null}
            </section>
          </Card>
          <Card tone="paper">
            <section className="flex flex-col gap-3">
              <h2 className="heading-6">{t("detail.documentsHeading")}</h2>
              <ul className="flex flex-col gap-2">
                {documents.map(({ kind, url }) => (
                  <li key={kind} className="flex items-center justify-between gap-3 rounded-tile bg-step px-4 py-2">
                    <span className="body-3">{kinds(kind)}</span>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center gap-1 title-4 underline underline-offset-2"
                      >
                        {t("detail.viewDocument")}
                        <ArrowUpRight />
                      </a>
                    ) : (
                      <span className="body-6 text-ink-soft">{t("detail.noDocument")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </Card>
        </div>
        <Card tone="paper" className="md:col-span-4">
          <section className="flex flex-col gap-4">
            <h2 className="heading-6">{t("detail.actionsHeading")}</h2>
            <ReviewActions cooperativeId={cooperative.id} status={cooperative.status} />
          </section>
        </Card>
      </div>
    </main>
  );
}
