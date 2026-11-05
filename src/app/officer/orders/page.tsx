import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { OFFICER_ORDER_TONE } from "@/components/orders/status";
import { ArrowUpRight, Chip, PageHeading } from "@/components/ui";
import { formatNaira } from "@/lib/money";
import { listCooperativeOrders } from "@/modules/orders/service";

export default function OfficerOrdersPage() {
  return (
    <Suspense fallback={null}>
      <OfficerOrders />
    </Suspense>
  );
}

async function OfficerOrders() {
  const actor = await requireActorForPage();
  if (actor.role !== "OFFICER") notFound();
  const t = await getTranslations("orders");
  const locale = await getLocale();
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const orders = await listCooperativeOrders(actor);

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("officer.title")} lead={t("officer.lead")} />
      {orders.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("officer.empty")}</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/officer/orders/${order.id}`}
                className="press press-lift flex min-h-11 flex-col gap-1 rounded-inner bg-paper p-4 hover:bg-step-deep md:p-6"
              >
                <span className="title-2 break-words">
                  {t("summary", { quantity: order.quantity, unit: order.lot.unit, crop: order.lot.crop })}
                </span>
                <span className="body-6 text-ink-soft">
                  {t("officer.buyer", { name: order.buyerName })} · {t("reference", { reference: order.reference })}
                </span>
                <span className="body-5 tabular-nums">{formatNaira(order.totalKobo)}</span>
                <span className="body-6">
                  {order.deliveryDate ? day.format(new Date(`${order.deliveryDate}T00:00:00Z`)) : t("officer.noDate")}
                </span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <Chip tone={OFFICER_ORDER_TONE[order.orderStatus]}>{t(`officerStatus.${order.orderStatus}`)}</Chip>
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
