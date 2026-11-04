import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { ArrowUpRight, Card, PageHeading } from "@/components/ui";
import { NotFoundError } from "@/lib/errors";
import {
  getNameChangeDocumentUrl,
  getNameChangeForReview,
  type AdminNameChange,
} from "@/modules/name-changes/service";
import { DecisionActions } from "./decision-actions";

export default function NameChangeReviewPage({ params }: { params: Promise<{ id: string }> }) {
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
  let request: AdminNameChange;
  try {
    request = await getNameChangeForReview(actor, id, new Date());
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const t = await getTranslations("admin.names");
  const kinds = await getTranslations("nameChange.kinds");
  const locale = await getLocale();
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Africa/Lagos" }).format(
      new Date(iso),
    );
  // Signed links are short-lived, so one is made on every request.
  const documentUrl = await getNameChangeDocumentUrl(actor, request.id);

  const rows: Array<[string, string]> = [
    [
      t("detail.subject"),
      `${request.subjectType === "USER" ? t("person") : t("cooperative")} · ${request.subjectLabel}`,
    ],
    [t("detail.currentName"), request.fromName],
    [t("detail.newName"), request.toName],
    [t("detail.reason"), request.reason],
    [t("detail.requester"), request.requesterName],
    [t("detail.submittedAt"), formatDate(request.createdAt)],
  ];
  const account =
    request.payoutAccountName === null
      ? t("detail.noAccount")
      : request.newNameMatchesAccount
        ? t("detail.accountMatches", { accountName: request.payoutAccountName })
        : t("detail.accountDiffers", { accountName: request.payoutAccountName });
  const decided = request.decidedAt ? formatDate(request.decidedAt) : "";

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <Link
        href="/admin/names"
        className="inline-flex min-h-11 items-center gap-2 self-start title-4 underline underline-offset-2"
      >
        {t("back")}
      </Link>
      <PageHeading title={t("fromTo", { from: request.fromName, to: request.toName })} />
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
            <section className="flex flex-col gap-3">
              <h2 className="heading-6">{t("detail.document")}</h2>
              <div className="flex items-center justify-between gap-3 rounded-tile bg-step px-4 py-2">
                <span className="body-3">{kinds(request.documentKind)}</span>
                <a
                  href={documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center gap-1 title-4 underline underline-offset-2"
                >
                  {t("detail.viewDocument")}
                  <ArrowUpRight />
                </a>
              </div>
            </section>
          </Card>
          <Card tone="paper">
            <section className="flex flex-col gap-2">
              <h2 className="heading-6">{t("detail.account")}</h2>
              <p className="body-3">{account}</p>
              {request.cooperativeId ? (
                <Link
                  href={`/admin/cooperatives/${request.cooperativeId}`}
                  className="inline-flex min-h-11 items-center self-start title-4 underline underline-offset-2"
                >
                  {t("detail.openCooperative")}
                </Link>
              ) : null}
            </section>
          </Card>
        </div>
        <Card tone="paper" className="md:col-span-4">
          <section className="flex flex-col gap-4">
            <h2 className="heading-6">{t("detail.actionsHeading")}</h2>
            {request.status === "PENDING" ? (
              request.canDecide ? (
                <DecisionActions requestId={request.id} />
              ) : (
                <p className="body-3">{t("detail.cannotDecide")}</p>
              )
            ) : (
              <p role="status" className="body-3">
                {request.status === "APPROVED"
                  ? t("detail.status.APPROVED", { date: decided })
                  : request.status === "REJECTED"
                    ? t("detail.status.REJECTED", { date: decided, reason: request.rejectionReason ?? "" })
                    : t("detail.status.WITHDRAWN", { date: decided })}
              </p>
            )}
          </section>
        </Card>
      </div>
    </main>
  );
}
