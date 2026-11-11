import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { AlertList } from "@/components/alert-list";
import { MarkAllReadButton } from "@/components/mark-all-read-button";
import { PageHeading } from "@/components/ui";
import { listOwnAlerts } from "@/modules/notifications/service";

// Every alert for the role in use, newest first, twenty to a page.
export default function AlertsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  return (
    <Suspense fallback={null}>
      <Alerts searchParams={searchParams} />
    </Suspense>
  );
}

async function Alerts({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  // Signed out, or holding no role, goes to sign-in.
  const actor = await requireActorForPage();
  const { page } = await searchParams;
  const t = await getTranslations("alerts");
  // A bad ?page= (text, zero, negative, past the end) shows the nearest page that exists.
  const result = await listOwnAlerts(actor, Number(page ?? 1));

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} />
      {result.alerts.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("empty")}</p>
      ) : (
        <>
          <div>
            <MarkAllReadButton label={t("markAll")} />
          </div>
          <div className="rounded-inner bg-paper p-2">
            <AlertList alerts={result.alerts} />
          </div>
        </>
      )}
      {result.pages > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label={t("title")}>
          {result.page > 1 ? (
            <Link href={`/alerts?page=${result.page - 1}`} className="press underline body-6">
              {t("newer")}
            </Link>
          ) : (
            <span />
          )}
          {result.page < result.pages ? (
            <Link href={`/alerts?page=${result.page + 1}`} className="press underline body-6">
              {t("older")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
