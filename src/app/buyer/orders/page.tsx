import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { BUYER_ORDER_TONE, buyerOrderStatusKey } from "@/components/orders/status";
import { ArrowUpRight, ButtonLink, Chip, PageHeading } from "@/components/ui";
import { formatNaira } from "@/lib/money";
import { listOwnOrders } from "@/modules/orders/service";

export default function BuyerOrdersPage() {
  return (
    <Suspense fallback={null}>
      <BuyerOrders />
    </Suspense>
  );
}

async function BuyerOrders() {
  const actor = await requireActorForPage();
  if (actor.role !== "BUYER") notFound();
  const t = await getTranslations("orders");
  const tn = await getTranslations("nav");
  const orders = await listOwnOrders(actor);

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("buyer.title")} lead={t("buyer.lead")}>
        <ButtonLink href="/lots" tone="ink">
          {tn("browseLots")}
        </ButtonLink>
      </PageHeading>
      {orders.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("buyer.empty")}</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/buyer/orders/${order.id}`}
                className="press press-lift flex min-h-11 flex-col gap-1 rounded-inner bg-paper p-4 hover:bg-step-deep md:p-6"
              >
                <span className="title-2 break-words">
                  {t("summary", { quantity: order.quantity, unit: order.lot.unit, crop: order.lot.crop })}
                </span>
                <span className="body-6 text-ink-soft">
                  {order.lot.cooperativeName} · {t("reference", { reference: order.reference })}
                </span>
                <span className="body-5 tabular-nums">{t("buyer.totalDue", { amount: formatNaira(order.totalKobo) })}</span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <Chip tone={BUYER_ORDER_TONE[order.status]}>{t(buyerOrderStatusKey(order.status))}</Chip>
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
