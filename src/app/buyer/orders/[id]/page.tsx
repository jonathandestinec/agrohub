import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { OpenThreadButton } from "@/components/messages/open-thread-button";
import { ThreadPanel } from "@/components/messages/thread-panel";
import { BUYER_ORDER_TONE, buyerOrderStatusKey } from "@/components/orders/status";
import { Card, Chip, PageHeading } from "@/components/ui";
import { NotFoundError } from "@/lib/errors";
import { formatNaira, refundForUnits } from "@/lib/money";
import { OrderActionButton } from "@/components/orders/order-actions";
import { confirmReceiptAction } from "../actions";
import { getThread } from "@/modules/messaging/service";
import { getOwnOrder, type BuyerOrder } from "@/modules/orders/service";

// Paystack sends the buyer back here. Returning never marks anything paid: the page shows what
// the server knows, which changes only when Paystack's webhook arrives.
export default function BuyerOrderPage({ params }: PageProps<"/buyer/orders/[id]">) {
  return (
    <Suspense fallback={null}>
      <BuyerOrderDetail params={params} />
    </Suspense>
  );
}

async function BuyerOrderDetail({ params }: { params: PageProps<"/buyer/orders/[id]">["params"] }) {
  const actor = await requireActorForPage();
  if (actor.role !== "BUYER") notFound();
  const { id } = await params;
  let order: BuyerOrder;
  try {
    order = await getOwnOrder(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const t = await getTranslations("orders");
  const locale = await getLocale();
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const thread = order.threadId ? await getThread(actor, order.threadId) : null;
  const unpaid = order.status === "AWAITING_PAYMENT" || order.status === "PAYMENT_EXPIRED";

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading
        title={t("summary", { quantity: order.quantity, unit: order.lot.unit, crop: order.lot.crop })}
        lead={`${order.lot.cooperativeName} · ${t("reference", { reference: order.reference })}`}
      >
        <Chip tone={BUYER_ORDER_TONE[order.status]}>{t(buyerOrderStatusKey(order.status))}</Chip>
      </PageHeading>
      <Card tone="paper" className="flex flex-col gap-2">
        <p className="body-4 tabular-nums">{t("buyer.goods", { amount: formatNaira(order.goodsKobo) })}</p>
        <p className="body-4 tabular-nums">
          {order.deliveryMethod === "DELIVERY" ? t("buyer.deliveryCost", { amount: formatNaira(order.deliveryKobo) }) : t("buyer.pickup")}
        </p>
        <p className="heading-6 tabular-nums">
          {unpaid ? t("buyer.totalDue", { amount: formatNaira(order.totalKobo) }) : t("buyer.total", { amount: formatNaira(order.totalKobo) })}
        </p>
        {order.refundedKobo > 0 ? (
          <p className="body-4 tabular-nums">{t("buyer.refunded", { amount: formatNaira(order.refundedKobo) })}</p>
        ) : null}
        {order.status === "AWAITING_PAYMENT" && order.reservedUntil ? (
          <p className="body-6">{t("buyer.reservedUntil", { time: time.format(new Date(order.reservedUntil)) })}</p>
        ) : null}
        {order.status === "AWAITING_PAYMENT" ? (
          <>
            <p className="body-6 text-ink-soft">{t("buyer.confirming")}</p>
            <Link href={`/buyer/orders/${order.id}`} className="body-6 underline underline-offset-2">
              {t("buyer.checkAgain")}
            </Link>
          </>
        ) : null}
        {order.status === "PAYMENT_EXPIRED" ? <p className="body-6 text-ink-soft">{t("buyer.paymentExpired")}</p> : null}
        {order.status === "PAID_HELD" || order.status === "PREPARING" ? (
          <p className="body-6 text-ink-soft">{t("buyer.held")}</p>
        ) : null}
        {order.deliveryDate ? (
          <p className="body-4">{t("buyer.deliveryDate", { date: day.format(new Date(`${order.deliveryDate}T00:00:00Z`)) })}</p>
        ) : null}
        <Link href={`/lots/${order.lot.id}`} className="body-6 underline underline-offset-2">
          {t("buyer.viewLot")}
        </Link>
      </Card>
      {order.status === "DELIVERED" && order.deliveredQuantity !== null ? (
        <Card tone="paper" className="flex flex-col gap-3">
          <h2 className="title-2">{t("buyer.deliveredHeading")}</h2>
          {order.deliveredQuantity < order.quantity ? (
            <p className="body-4 tabular-nums">
              {t("buyer.shortfall", {
                delivered: order.deliveredQuantity,
                quantity: order.quantity,
                amount: formatNaira(refundForUnits(order.unitKobo, order.quantity - order.deliveredQuantity)),
              })}
            </p>
          ) : (
            <p className="body-4">{t("buyer.deliveredAll", { quantity: order.quantity, unit: order.lot.unit })}</p>
          )}
          <p className="body-6 text-ink-soft">{t("buyer.confirmLead")}</p>
          <OrderActionButton action={confirmReceiptAction.bind(null, order.id)} label={t("buyer.confirm")} />
        </Card>
      ) : null}
      <section aria-labelledby="thread-heading" className="flex flex-col gap-3">
        <h2 id="thread-heading" className="heading-6">
          {t("buyer.threadHeading")}
        </h2>
        {thread ? <ThreadPanel thread={thread} /> : <OpenThreadButton lotId={order.lot.id} label={t("buyer.messageCooperative")} />}
      </section>
    </main>
  );
}
