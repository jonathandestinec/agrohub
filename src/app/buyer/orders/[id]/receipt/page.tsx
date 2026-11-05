import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { Card, PageHeading } from "@/components/ui";
import { NotFoundError } from "@/lib/errors";
import { formatNaira } from "@/lib/money";
import { getReceipt, type Receipt } from "@/modules/orders/service";

// A printable receipt (the browser prints it): the cooperative is the seller, AgroHub the platform.
export default function ReceiptPage({ params }: PageProps<"/buyer/orders/[id]/receipt">) {
  return (
    <Suspense fallback={null}>
      <ReceiptDetail params={params} />
    </Suspense>
  );
}

async function ReceiptDetail({ params }: { params: PageProps<"/buyer/orders/[id]/receipt">["params"] }) {
  const actor = await requireActorForPage();
  if (actor.role !== "BUYER") notFound();
  const { id } = await params;
  let receipt: Receipt;
  try {
    receipt = await getReceipt(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const t = await getTranslations("orders.receipt");
  const locale = await getLocale();
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8 print:bg-paper">
      <Link href={`/buyer/orders/${receipt.id}`} className="inline-flex min-h-11 items-center gap-2 self-start title-4 underline underline-offset-2 print:hidden">
        {t("back")}
      </Link>
      <PageHeading title={t("title", { reference: receipt.reference })} lead={t("lead", { seller: receipt.cooperativeName })} />
      <Card tone="paper" className="flex flex-col gap-2">
        <p className="body-6">{t("paidAt", { time: time.format(new Date(receipt.paidAt)) })}</p>
        <p className="body-4">{t("item", { quantity: receipt.quantity, unit: receipt.unit, crop: receipt.crop, price: formatNaira(receipt.unitKobo) })}</p>
        {receipt.deliveredQuantity !== null && receipt.deliveredQuantity < receipt.quantity ? (
          <p className="body-4">{t("delivered", { delivered: receipt.deliveredQuantity, quantity: receipt.quantity, unit: receipt.unit })}</p>
        ) : null}
        <p className="body-4 tabular-nums">{t("goods", { amount: formatNaira(receipt.goodsKobo) })}</p>
        {receipt.deliveryKobo > 0 ? <p className="body-4 tabular-nums">{t("delivery", { amount: formatNaira(receipt.deliveryKobo) })}</p> : null}
        <p className="heading-6 tabular-nums">{t("total", { amount: formatNaira(receipt.totalKobo) })}</p>
        {receipt.refunds.map((r, i) => (
          <p key={i} className="body-4 tabular-nums">
            {t("refund", { amount: formatNaira(r.amountKobo), reason: t(`reason.${r.reason}`) })} {r.processed ? "" : t("refundPending")}
          </p>
        ))}
        {receipt.refunds.length > 0 ? <p className="heading-6 tabular-nums">{t("net", { amount: formatNaira(receipt.netPaidKobo) })}</p> : null}
      </Card>
      <p className="body-6 text-ink-soft">{t("platform")}</p>
    </main>
  );
}
