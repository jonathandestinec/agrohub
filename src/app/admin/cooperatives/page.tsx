import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { AuthCard } from "@/components/auth-ui";
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
    <AuthCard title={t("title")}>
      {queue.length === 0 ? (
        <p className="text-base text-muted">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {queue.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/cooperatives/${c.id}`}
                className="flex min-h-11 flex-col gap-1 rounded-lg border border-border bg-surface p-4"
              >
                <span className="text-base font-semibold">{c.name}</span>
                <span className="text-sm text-muted">
                  {c.lga}, {c.state}
                </span>
                <span className="text-sm text-muted">
                  {c.submittedAt
                    ? t("submitted", { date: formatDate(c.submittedAt) })
                    : null}
                </span>
                <span className="text-sm font-medium text-primary">
                  {t("waiting", { days: c.waitingDays })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AuthCard>
  );
}
