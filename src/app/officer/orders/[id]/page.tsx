import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { ThreadPanel } from "@/components/messages/thread-panel";
import { OrderActionButton, OrderFieldForm } from "@/components/orders/order-actions";
import { OFFICER_ORDER_TONE } from "@/components/orders/status";
import { Card, Chip, PageHeading } from "@/components/ui";
import { NotFoundError } from "@/lib/errors";
import { lagosDateKey } from "@/lib/lagos-date";
import { formatNaira } from "@/lib/money";
import { getThread } from "@/modules/messaging/service";
import { getCooperativeOrder, type OfficerOrder } from "@/modules/orders/service";
import { answerCancelRequestAction, cancelOrderAction, markDeliveredAction, setDeliveryDateAction, startPreparingAction } from "../actions";

// The cooperative's view of one paid order, with its delivery steps.
export default function OfficerOrderPage({ params }: PageProps<"/officer/orders/[id]">) {
  return (
    <Suspense fallback={null}>
      <OfficerOrderDetail params={params} />
    </Suspense>
  );
}

async function OfficerOrderDetail({ params }: { params: PageProps<"/officer/orders/[id]">["params"] }) {
  const actor = await requireActorForPage();
  if (actor.role !== "OFFICER") notFound();
  const { id } = await params;
  let order: OfficerOrder;
  try {
    order = await getCooperativeOrder(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const t = await getTranslations("orders");
  const locale = await getLocale();
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const thread = order.threadId ? await getThread(actor, order.threadId) : null;
  const deliverable = order.orderStatus === "PAID_HELD" || order.orderStatus === "PREPARING";

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading
        title={t("summary", { quantity: order.quantity, unit: order.lot.unit, crop: order.lot.crop })}
        lead={`${t("officer.buyer", { name: order.buyerName })} · ${t("reference", { reference: order.reference })}`}
      >
        <Chip tone={OFFICER_ORDER_TONE[order.orderStatus]}>{t(`officerStatus.${order.orderStatus}`)}</Chip>
      </PageHeading>
      <Card tone="paper" className="flex flex-col gap-2">
        <p className="body-4 tabular-nums">{t("buyer.goods", { amount: formatNaira(order.goodsKobo) })}</p>
        {order.deliveryMethod === "DELIVERY" ? (
          <p className="body-4 tabular-nums">{t("officer.deliveryCost", { amount: formatNaira(order.deliveryKobo) })}</p>
        ) : (
          <p className="body-4">{t("buyer.pickup")}</p>
        )}
        <p className="heading-6 tabular-nums">{t("buyer.total", { amount: formatNaira(order.totalKobo) })}</p>
        <p className="body-4 tabular-nums">{t("officer.cut", { amount: formatNaira(order.cutKobo) })}</p>
        <p className="body-4 tabular-nums">{t("officer.fee", { amount: formatNaira(order.feeKobo) })}</p>
        <p className="body-4">
          {order.deliveryDate ? t("buyer.deliveryDate", { date: day.format(new Date(`${order.deliveryDate}T00:00:00Z`)) }) : t("officer.noDate")}
        </p>
      </Card>
      {deliverable ? (
        <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
          <h2 id="steps-heading" className="heading-6">
            {t("officer.steps")}
          </h2>
          {order.orderStatus === "PAID_HELD" ? (
            <OrderActionButton action={startPreparingAction.bind(null, order.id)} label={t("officer.startPreparing")} />
          ) : null}
          <OrderFieldForm
            action={setDeliveryDateAction.bind(null, order.id)}
            heading={t("officer.dateHeading")}
            label={t("officer.dateLabel")}
            submit={t("officer.dateSubmit")}
            kind="date"
            name="deliveryDate"
            defaultValue={order.deliveryDate ?? lagosDateKey(new Date())}
          />
          <OrderFieldForm
            action={markDeliveredAction.bind(null, order.id)}
            heading={t("officer.deliveredHeading")}
            label={t("officer.deliveredLabel", { unit: order.lot.unit })}
            submit={t("officer.deliveredSubmit")}
            hint={t("officer.deliveredHint", { quantity: order.quantity })}
            kind="number"
            name="deliveredQuantity"
            defaultValue={String(order.quantity)}
          />
          {order.cancelRequested ? (
            <Card tone="paper" className="flex flex-col gap-3">
              <h2 className="title-2">{t("officer.requestHeading")}</h2>
              <div className="flex flex-wrap gap-3">
                <OrderActionButton action={answerCancelRequestAction.bind(null, order.id, true)} label={t("officer.agree")} />
                <OrderActionButton action={answerCancelRequestAction.bind(null, order.id, false)} label={t("officer.decline")} tone="paper" />
              </div>
            </Card>
          ) : null}
          <OrderFieldForm
            action={cancelOrderAction.bind(null, order.id)}
            heading={t("officer.cancelHeading")}
            label={t("officer.cancelLabel")}
            submit={t("officer.cancel")}
            hint={t("officer.cancelHint")}
            kind="text"
            name="cancelReason"
          />
        </section>
      ) : null}
      {order.orderStatus === "DELIVERED_MARKED" && order.deliveredQuantity !== null ? (
        <Card tone="paper">
          <p className="body-4">{t("officer.awaitingBuyer", { delivered: order.deliveredQuantity, quantity: order.quantity, unit: order.lot.unit })}</p>
        </Card>
      ) : null}
      <Card tone="paper" className="flex flex-col gap-2">
        <h2 className="title-2">{t("officer.shares")}</h2>
        <ul className="flex flex-col gap-1">
          {order.farmerShares.map((share) => (
            <li key={share.farmerName} className="body-4 tabular-nums">
              {t("officer.share", { name: share.farmerName, quantity: share.quantity, unit: order.lot.unit, amount: formatNaira(share.amountKobo) })}
            </li>
          ))}
        </ul>
      </Card>
      {thread ? (
        <section aria-labelledby="thread-heading" className="flex flex-col gap-3">
          <h2 id="thread-heading" className="heading-6">
            {t("officer.threadHeading")}
          </h2>
          <ThreadPanel thread={thread} />
        </section>
      ) : null}
    </main>
  );
}
