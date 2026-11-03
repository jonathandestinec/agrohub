import { buttonClass } from "@/components/ui/button";
import { Card, Chip, PageHeading, type ChipTone } from "@/components/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { AuthCard } from "@/components/auth-ui";
import { listBanks, type Bank } from "@/lib/paystack";
import { getCooperativeBankAccount } from "@/modules/banking/service";
import { formatEffectiveAt } from "@/modules/banking/views";
import {
  CERTIFICATE_EXPIRED_NOTE,
  DOCUMENT_KINDS,
} from "@/modules/cooperatives/schema";
import { getOwnCooperative } from "@/modules/cooperatives/service";
import {
  toDocumentSummary,
  toOwnCooperative,
} from "@/modules/cooperatives/views";
import { STATES } from "@/modules/geo/states";
import type { Actor } from "@/modules/identity/policies";
import { currentUser } from "@/modules/identity/session";
import { listMemberships } from "@/modules/identity/service";
import { BankForm } from "./bank-form";
import { CreateCooperativeForm } from "./create-cooperative-form";
import { DocumentUploads } from "./document-uploads";
import { EditCooperativeForm } from "./edit-cooperative-form";
import { CutForm } from "./cut-form";
import { effectiveCutBps, formatPercent } from "@/lib/money";
import { getPlatformSettings } from "@/modules/settings/service";

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
        <p className="body-3 text-ink-soft">{t("intro")}</p>
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
  let chip: { tone: ChipTone; key: "verified" | "suspended" | "waiting" | "changesRequested" | "incomplete" };
  if (view.status === "VERIFIED") {
    statusText = t("status.verified");
    chip = { tone: "forest", key: "verified" };
  } else if (view.status === "SUSPENDED") {
    statusText = t("status.suspended");
    chip = { tone: "paper", key: "suspended" };
  } else if (view.submittedAt) {
    statusText = t("status.waiting", { date: formatDate(view.submittedAt) });
    chip = { tone: "warn", key: "waiting" };
  } else if (view.reviewNote === CERTIFICATE_EXPIRED_NOTE) {
    statusText = t("status.certificateExpired");
    chip = { tone: "warn", key: "changesRequested" };
  } else if (view.reviewNote) {
    // Rejected: submittedAt was cleared, so re-uploading a document sends it back for review.
    statusText = t("status.changesRequested", { note: view.reviewNote });
    chip = { tone: "warn", key: "changesRequested" };
  } else {
    statusText = t("status.incomplete");
    chip = { tone: "paper", key: "incomplete" };
  }

  const uploaded = DOCUMENT_KINDS.filter((kind) =>
    documents.some((d) => toDocumentSummary(d).kind === kind),
  );

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={view.name} lead={`${view.registrationNumber} · ${view.lga}, ${view.state}`}>
        <Chip tone={chip.tone}>{t(`chip.${chip.key}`)}</Chip>
      </PageHeading>
      <p role="status" className="rounded-inner bg-paper p-4 body-3 md:p-6">
        {statusText}
      </p>
      <div className="grid gap-2 md:grid-cols-12">
        <div className="flex flex-col gap-2 md:col-span-7">
          {view.status === "PENDING" ? (
            <Card tone="paper">
              <EditCooperativeForm
                details={{
                  name: view.name,
                  registrationNumber: view.registrationNumber,
                  state: view.state,
                  lga: view.lga,
                }}
                states={[...STATES]}
              />
            </Card>
          ) : null}
          <Card tone="paper">
            <CutSection cutBps={view.cutBps} />
          </Card>
          <Card tone="paper">
            <section className="flex flex-col gap-4">
              <h2 className="heading-6">{t("documentsHeading")}</h2>
              <p className="body-6 text-ink-soft">{t("documentsIntro")}</p>
              <DocumentUploads kinds={[...DOCUMENT_KINDS]} uploaded={uploaded} />
            </section>
          </Card>
        </div>
        <Card tone="paper" className="md:col-span-5">
          <BankSection actor={actor} cooperativeId={view.id} locale={locale} />
        </Card>
      </div>
    </main>
  );
}

async function BankSection({
  actor,
  cooperativeId,
  locale,
}: {
  actor: Actor;
  cooperativeId: string;
  locale: string;
}) {
  const t = await getTranslations("officer.onboarding.bank");
  const account = await getCooperativeBankAccount(actor, cooperativeId, new Date());
  // Paystack can be unreachable or unconfigured; the rest of the page must still render.
  let banks: Bank[] | null = null;
  if (actor.twoFactorEnabled) {
    try {
      banks = await listBanks();
    } catch {
      banks = null;
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="heading-6">
        {t("heading")}
      </h2>
      <p className="body-6 text-ink-soft">{t("intro")}</p>
      <p className="rounded-inner bg-step p-4 body-3">
        {account.accountName && account.bankName
          ? t("current", { accountName: account.accountName, bankName: account.bankName })
          : t("none")}
      </p>
      {account.change?.state === "AWAITING_CONFIRMATION" ? (
        <p role="status" className="body-3">
          {t("pending")}
        </p>
      ) : null}
      {account.change?.state === "CONFIRMED" ? (
        <p role="status" className="body-3">
          {t("confirmed", { date: formatEffectiveAt(account.change.effectiveAt, locale) })}
        </p>
      ) : null}
      {!actor.twoFactorEnabled ? (
        <>
          <p className="body-3">{t("needsTwoFactor")}</p>
          <Link
            href="/two-factor"
            className={`${buttonClass("ink")} w-full`}
          >
            {t("enableTwoFactor")}
          </Link>
        </>
      ) : banks ? (
        <BankForm banks={banks} />
      ) : (
        <p role="alert" className="body-3">
          {t("unavailable")}
        </p>
      )}
    </section>
  );
}

async function CutSection({ cutBps }: { cutBps: number }) {
  const t = await getTranslations("officer.onboarding.cut");
  const { maxCooperativeCutBps } = await getPlatformSettings();
  const effective = effectiveCutBps(cutBps, maxCooperativeCutBps);
  return (
    <section className="flex flex-col gap-4">
      <h2 className="heading-6">{t("heading")}</h2>
      <p className="body-6 text-ink-soft">
        {t("intro", { max: formatPercent(maxCooperativeCutBps) })}
      </p>
      {effective < cutBps ? (
        <p role="status" className="rounded-inner bg-step p-4 body-6">
          {t("aboveMaximum", { cut: formatPercent(cutBps), effective: formatPercent(effective) })}
        </p>
      ) : null}
      <CutForm current={formatPercent(cutBps).slice(0, -1)} />
    </section>
  );
}
