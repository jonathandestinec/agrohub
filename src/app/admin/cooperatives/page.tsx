import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { ArrowUpRight, Chip, PageHeading } from "@/components/ui";
import { listVerificationQueue } from "@/modules/cooperatives/service";

export default function QueuePage() {
  return (
    <Suspense fallback={null}>
      <Queue />
    </Suspense>
  );
}

async function Queue() {
  const actor = await requireActorForPage();
  if (actor.role !== "ADMIN") notFound();
  const t = await getTranslations("admin.cooperatives");
  const locale = await getLocale();
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(iso),
    );
  const queue = await listVerificationQueue(actor, new Date());

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} />
      {queue.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("empty")}</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {queue.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/cooperatives/${c.id}`}
                className="press press-lift flex min-h-11 flex-col gap-1 rounded-inner bg-paper p-4 hover:bg-step-deep md:p-6"
              >
                <span className="title-2 break-words">{c.name}</span>
                <span className="body-6 text-ink-soft">
                  {c.lga}, {c.state}
                </span>
                <span className="body-6 text-ink-soft">
                  {c.submittedAt
                    ? t("submitted", { date: formatDate(c.submittedAt) })
                    : null}
                </span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <Chip tone="warn">{t("waiting", { days: c.waitingDays })}</Chip>
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
