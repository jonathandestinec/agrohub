import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { OrderFieldForm } from "@/components/orders/order-actions";
import { ArrowUpRight, Chip, PageHeading } from "@/components/ui";
import { listOrderQueue } from "@/modules/orders/service";
import { resolveIssueAction } from "./actions";

// Everything waiting for an admin, oldest first: disputes, timeouts, suspended cooperatives'
// orders, payout problems and reconciliation issues.
export default function AdminOrderQueuePage() {
  return (
    <Suspense fallback={null}>
      <Queue />
    </Suspense>
  );
}

async function Queue() {
  const actor = await requireActorForPage();
  if (actor.role !== "ADMIN") notFound();
  const t = await getTranslations("admin.orders");
  const locale = await getLocale();
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
  const queue = await listOrderQueue(actor);

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")}>
        <Link href="/admin/payouts" className="inline-flex min-h-11 items-center title-4 underline underline-offset-2">
          {t("payoutsLink")}
        </Link>
      </PageHeading>
      {queue.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("empty")}</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {queue.map((item) => {
            const body = (
              <>
                <span className="body-6 text-ink-soft">
                  {item.orderReference ? t("order", { reference: item.orderReference }) : t("noOrder")} · {day.format(new Date(item.since))}
                </span>
                <span className="title-2 break-words">{t(`kind.${item.kind}`)}</span>
                {item.detail ? <span className="body-4 break-words">{item.detail}</span> : null}
                <span className="mt-2 flex items-center justify-between gap-2">
                  <Chip tone="warn">{t("waiting")}</Chip>
                  {item.orderId ? <ArrowUpRight /> : null}
                </span>
              </>
            );
            return (
              <li key={`${item.kind}-${item.id}`}>
                {item.orderId ? (
                  <Link
                    href={`/admin/orders/${item.orderId}`}
                    className="press press-lift flex min-h-11 flex-col gap-1 rounded-inner bg-paper p-4 hover:bg-step-deep md:p-6"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-11 flex-col gap-1 rounded-inner bg-paper p-4 md:p-6">{body}</div>
                )}
                {item.kind === "RECONCILIATION" ? (
                  <OrderFieldForm
                    action={resolveIssueAction.bind(null, item.id)}
                    label={t("issueNote")}
                    submit={t("resolveIssue")}
                    kind="text"
                    name={`issue-${item.id}`}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
