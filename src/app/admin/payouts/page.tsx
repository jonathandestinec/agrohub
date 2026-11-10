import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { OrderActionButton } from "@/components/orders/order-actions";
import { Card, Chip, PageHeading } from "@/components/ui";
import { formatNaira } from "@/lib/money";
import { listPayoutIssues } from "@/modules/payments/service";
import { retryPayoutAction, retryToCurrentAccountAction, unblockPayoutAction } from "./actions";

// Payouts that need an admin: failed, blocked, refused for a low balance, or awaiting Paystack.
export default function AdminPayoutsPage() {
  return (
    <Suspense fallback={null}>
      <Issues />
    </Suspense>
  );
}

async function Issues() {
  const actor = await requireActorForPage();
  if (actor.role !== "ADMIN") notFound();
  const t = await getTranslations("admin.payouts");
  const locale = await getLocale();
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
  const issues = await listPayoutIssues(actor);

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")} />
      {issues.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {issues.map((p) => (
            <li key={p.id}>
              <Card tone="paper" className="flex flex-col gap-2">
                <span className="body-6 text-ink-soft">
                  {t("order", { reference: p.orderReference })} · {t(`recipient.${p.recipientType}`)}
                </span>
                <span className="title-2 break-words">{p.recipientName}</span>
                <span className="heading-6 tabular-nums">{formatNaira(p.amountKobo)}</span>
                <span className="flex flex-wrap gap-2">
                  <Chip tone="warn">{t(`status.${p.status}`)}</Chip>
                  <Chip tone="paper">{t("attempts", { count: p.attempts })}</Chip>
                </span>
                {p.lastFailure ? <p className="body-6">{t("lastFailure", { reason: p.lastFailure })}</p> : null}
                {p.sentAt ? <p className="body-6">{t("awaiting", { time: time.format(new Date(p.sentAt)) })}</p> : null}
                {p.status === "FAILED" ? (
                  <div className="flex flex-wrap gap-3">
                    <OrderActionButton action={retryPayoutAction.bind(null, p.id)} label={t("retry")} />
                    <OrderActionButton action={retryToCurrentAccountAction.bind(null, p.id)} label={t("retryCurrent")} tone="paper" />
                  </div>
                ) : null}
                {p.status === "BLOCKED" ? <OrderActionButton action={unblockPayoutAction.bind(null, p.id)} label={t("unblock")} /> : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
