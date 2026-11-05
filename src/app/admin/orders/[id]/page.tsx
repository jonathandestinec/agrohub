import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { DecisionForm } from "@/components/orders/decision-form";
import { Card, Chip, PageHeading } from "@/components/ui";
import { NotFoundError } from "@/lib/errors";
import { formatNaira } from "@/lib/money";
import { getOrderForAdmin, type AdminOrder } from "@/modules/orders/service";
import { resolveDisputeAction } from "../actions";

// One order as an admin sees it: the thread, delivery marks, ledger totals, payouts and disputes.
export default function AdminOrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  return (
    <Suspense fallback={null}>
      <Detail params={params} />
    </Suspense>
  );
}

const MONEY_OUTCOMES = ["RELEASE", "REFUND_ALL", "REFUND_UNITS"] as const;

async function Detail({ params }: { params: PageProps<"/admin/orders/[id]">["params"] }) {
  const actor = await requireActorForPage();
  if (actor.role !== "ADMIN") notFound();
  const { id } = await params;
  let order: AdminOrder;
  try {
    order = await getOrderForAdmin(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const t = await getTranslations("admin.orders");
  const locale = await getLocale();
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
  const frozen = order.status === "DISPUTED" || order.status === "TIMED_OUT";
  const open = ["PAID_HELD", "PREPARING", "DELIVERED_MARKED"].includes(order.status);

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <Link href="/admin/orders" className="inline-flex min-h-11 items-center gap-2 self-start title-4 underline underline-offset-2">
        {t("back")}
      </Link>
      <PageHeading
        title={t("summary", { quantity: order.quantity, unit: order.unit, crop: order.crop })}
        lead={`${t("order", { reference: order.reference })} · ${order.cooperativeName} · ${order.buyerName}`}
      >
        <Chip tone={frozen ? "warn" : "paper"}>{t(`status.${order.status}`)}</Chip>
      </PageHeading>
      <Card tone="paper" className="flex flex-col gap-2">
        <p className="heading-6 tabular-nums">{t("total", { amount: formatNaira(order.totalKobo) })}</p>
        <p className="body-4 tabular-nums">{t("unit", { amount: formatNaira(order.unitKobo) })}</p>
        {order.deliveredQuantity !== null ? (
          <p className="body-4">{t("delivered", { delivered: order.deliveredQuantity, quantity: order.quantity, unit: order.unit })}</p>
        ) : null}
        {order.paidAt ? <p className="body-6">{t("paidAt", { time: time.format(new Date(order.paidAt)) })}</p> : null}
        {order.deliveredMarkedAt ? <p className="body-6">{t("markedAt", { time: time.format(new Date(order.deliveredMarkedAt)) })}</p> : null}
      </Card>
      {order.disputes.map((d) => (
        <Card key={d.id} tone="paper" className="flex flex-col gap-3">
          <h2 className="title-2">{t(`kind.${d.kind}`)}</h2>
          <p className="body-4 break-words">{d.reason}</p>
          <p className="body-6 text-ink-soft">{time.format(new Date(d.createdAt))}</p>
          {d.status === "OPEN" && (frozen || !open) ? (
            <DecisionForm orderId={order.id} disputeId={d.id} outcomes={frozen ? [...MONEY_OUTCOMES] : ["NOTE"]} action={resolveDisputeAction} />
          ) : null}
          {d.status === "RESOLVED" ? (
            <p className="body-4">{t("decided", { outcome: t(`outcome.${d.outcome ?? "NOTE"}`), note: d.decisionNote ?? "" })}</p>
          ) : null}
        </Card>
      ))}
      <Card tone="paper" className="flex flex-col gap-2">
        <h2 className="title-2">{t("ledger")}</h2>
        <dl className="grid gap-2 sm:grid-cols-2">
          {Object.entries(order.ledger).map(([account, kobo]) => (
            <div key={account}>
              <dt className="body-6 text-ink-soft">{account}</dt>
              <dd className="body-4 tabular-nums">{formatNaira(kobo)}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {order.payouts.length > 0 ? (
        <Card tone="paper" className="flex flex-col gap-2">
          <h2 className="title-2">{t("payouts")}</h2>
          <ul className="flex flex-col gap-1">
            {order.payouts.map((p) => (
              <li key={p.id} className="body-4 tabular-nums">
                {t("payout", { recipient: p.recipientType, part: p.part, amount: formatNaira(p.amountKobo), status: p.status })}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {order.refunds.length > 0 ? (
        <Card tone="paper" className="flex flex-col gap-2">
          <h2 className="title-2">{t("refunds")}</h2>
          <ul className="flex flex-col gap-1">
            {order.refunds.map((r, i) => (
              <li key={i} className="body-4 tabular-nums">
                {t("refund", { amount: formatNaira(r.amountKobo), reason: r.reason, status: r.status })}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <section aria-labelledby="thread-heading" className="flex flex-col gap-3">
        <h2 id="thread-heading" className="heading-6">
          {t("thread")}
        </h2>
        <ol className="flex flex-col gap-2">
          {order.messages.map((m) => (
            <li key={m.id} className="rounded-inner bg-paper p-3">
              <p className="body-6 text-ink-soft">
                {m.author} · {time.format(new Date(m.createdAt))}
              </p>
              <p className="body-4 whitespace-pre-line break-words">{m.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
