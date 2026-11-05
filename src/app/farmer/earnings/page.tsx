import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { ArrowUpRight, Chip, PageHeading } from "@/components/ui";
import { formatNaira } from "@/lib/money";
import { listOwnEarnings } from "@/modules/orders/service";

// The farmer's earnings: one statement per completed sale of a lot they contributed to.
export default function EarningsPage() {
  return (
    <Suspense fallback={null}>
      <Earnings />
    </Suspense>
  );
}

async function Earnings() {
  const actor = await requireActorForPage();
  if (actor.role !== "FARMER") notFound();
  const t = await getTranslations("earnings");
  const locale = await getLocale();
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Africa/Lagos" });
  const statements = await listOwnEarnings(actor);

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")} />
      {statements.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("empty")}</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {statements.map((s) => (
            <li key={s.orderId}>
              <Link
                href={`/farmer/earnings/${s.orderId}`}
                className="press press-lift flex min-h-11 flex-col gap-1 rounded-inner bg-paper p-4 hover:bg-step-deep md:p-6"
              >
                <span className="body-6 text-ink-soft">
                  {t("sale", { reference: s.reference })} · {day.format(new Date(s.completedAt))}
                </span>
                <span className="title-2">{t("summary", { quantity: s.contributedQuantity, unit: s.unit, crop: s.crop })}</span>
                <span className="heading-6 tabular-nums">{t("takeHome", { amount: formatNaira(s.takeHomeKobo) })}</span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <Chip tone={s.status === "PAID" ? "lime" : s.status === "PROBLEM" ? "warn" : "paper"}>{t(`status.${s.status}`)}</Chip>
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
