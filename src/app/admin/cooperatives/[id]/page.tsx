import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { AuthCard } from "@/components/auth-ui";
import { NotFoundError } from "@/lib/errors";
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

  return (
    <AuthCard title={cooperative.name}>
      <Link
        href="/admin/cooperatives"
        className="inline-flex min-h-11 items-center text-sm text-primary"
      >
        {t("back")}
      </Link>
      <dl className="flex flex-col gap-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-base">{value}</dd>
          </div>
        ))}
      </dl>
      <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">
        {t("detail.documentsHeading")}
      </h2>
      <ul className="flex flex-col gap-2">
        {documents.map(({ kind, url }) => (
          <li key={kind} className="flex items-center justify-between gap-3">
            <span className="text-base">{kinds(kind)}</span>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center text-base font-medium text-primary"
              >
                {t("detail.viewDocument")}
              </a>
            ) : (
              <span className="text-sm text-muted">{t("detail.noDocument")}</span>
            )}
          </li>
        ))}
      </ul>
      <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">
        {t("detail.actionsHeading")}
      </h2>
      <ReviewActions cooperativeId={cooperative.id} status={cooperative.status} />
    </AuthCard>
  );
}
