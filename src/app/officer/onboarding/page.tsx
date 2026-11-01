import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { AuthCard } from "@/components/auth-ui";
import { DOCUMENT_KINDS } from "@/modules/cooperatives/schema";
import { getOwnCooperative } from "@/modules/cooperatives/service";
import {
  toDocumentSummary,
  toOwnCooperative,
} from "@/modules/cooperatives/views";
import { STATES } from "@/modules/geo/states";
import { currentUser } from "@/modules/identity/session";
import { listMemberships } from "@/modules/identity/service";
import { CreateCooperativeForm } from "./create-cooperative-form";
import { DocumentUploads } from "./document-uploads";

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingStep />
    </Suspense>
  );
}

async function OnboardingStep() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const t = await getTranslations("officer.onboarding");
  const memberships = await listMemberships(user.userId);

  // No officer membership yet: this signed-in user creates their cooperative.
  if (!memberships.some((m) => m.role === "OFFICER")) {
    return (
      <AuthCard title={t("title")}>
        <p className="text-base text-muted">{t("intro")}</p>
        <CreateCooperativeForm states={[...STATES]} />
      </AuthCard>
    );
  }

  const actor = await requireActorForPage();
  if (actor.role !== "OFFICER") redirect("/");
  const { cooperative, documents } = await getOwnCooperative(actor);
  const view = toOwnCooperative(cooperative);
  const locale = await getLocale();
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(iso),
    );

  let statusText: string;
  if (view.status === "VERIFIED") statusText = t("status.verified");
  else if (view.status === "SUSPENDED") statusText = t("status.suspended");
  else if (view.submittedAt) {
    statusText = t("status.waiting", { date: formatDate(view.submittedAt) });
  } else if (view.reviewNote) {
    // Rejected: submittedAt was cleared, so re-uploading a document sends it back for review.
    statusText = t("status.changesRequested", { note: view.reviewNote });
  } else statusText = t("status.incomplete");

  const uploaded = DOCUMENT_KINDS.filter((kind) =>
    documents.some((d) => toDocumentSummary(d).kind === kind),
  );

  return (
    <AuthCard title={view.name}>
      <p className="text-sm text-muted">
        {view.registrationNumber} · {view.lga}, {view.state}
      </p>
      <p
        role="status"
        className="rounded-md border border-border bg-surface px-3 py-3 text-base"
      >
        {statusText}
      </p>
      <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">
        {t("documentsHeading")}
      </h2>
      <p className="text-sm text-muted">{t("documentsIntro")}</p>
      <DocumentUploads kinds={[...DOCUMENT_KINDS]} uploaded={uploaded} />
    </AuthCard>
  );
}
