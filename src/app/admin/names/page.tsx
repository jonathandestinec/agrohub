import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { ArrowUpRight, Chip, PageHeading } from "@/components/ui";
import { listNameChangeQueue } from "@/modules/name-changes/service";

export default function NameChangeQueuePage() {
  return (
    <Suspense fallback={null}>
      <Queue />
    </Suspense>
  );
}

async function Queue() {
  const actor = await requireActorForPage();
  if (actor.role !== "ADMIN") notFound();
  const t = await getTranslations("admin.names");
  const queue = await listNameChangeQueue(actor, new Date());

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")} />
      {queue.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("empty")}</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {queue.map((r) => (
            <li key={r.id}>
              <Link
                href={`/admin/names/${r.id}`}
                className="press press-lift flex min-h-11 flex-col gap-1 rounded-inner bg-paper p-4 hover:bg-step-deep md:p-6"
              >
                <span className="body-6 text-ink-soft">
                  {r.subjectType === "USER" ? t("person") : t("cooperative")} · {r.subjectLabel}
                </span>
                <span className="title-2 break-words">
                  {t("fromTo", { from: r.fromName, to: r.toName })}
                </span>
                <span className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap gap-2">
                    <Chip tone="warn">{t("waiting", { days: r.waitingDays })}</Chip>
                    {r.canDecide ? null : <Chip tone="paper">{t("cannotDecideChip")}</Chip>}
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
