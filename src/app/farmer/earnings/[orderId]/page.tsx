import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { Card, Chip, PageHeading } from "@/components/ui";
import { NotFoundError } from "@/lib/errors";
import { formatNaira, formatPercent } from "@/lib/money";
import { getEarningsStatement, type EarningsStatement } from "@/modules/orders/service";

// A printable earnings statement for one sale: the farmer's share, the cut and fee, and the payouts.
export default function StatementPage({ params }: PageProps<"/farmer/earnings/[orderId]">) {
  return (
    <Suspense fallback={null}>
      <Statement params={params} />
    </Suspense>
  );
}

async function Statement({ params }: { params: PageProps<"/farmer/earnings/[orderId]">["params"] }) {
  const actor = await requireActorForPage();
  if (actor.role !== "FARMER") notFound();
  const { orderId } = await params;
  let s: EarningsStatement;
  try {
    s = await getEarningsStatement(actor, orderId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const t = await getTranslations("earnings");
  const locale = await getLocale();
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Africa/Lagos" });

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8 print:bg-paper">
      <Link href="/farmer/earnings" className="inline-flex min-h-11 items-center gap-2 self-start title-4 underline underline-offset-2 print:hidden">
        {t("back")}
      </Link>
      <PageHeading title={t("statementTitle", { reference: s.reference })} lead={day.format(new Date(s.completedAt))}>
        <Chip tone={s.status === "PAID" ? "lime" : s.status === "PROBLEM" ? "warn" : "paper"}>{t(`status.${s.status}`)}</Chip>
      </PageHeading>
      <Card tone="paper" className="flex flex-col gap-2">
        <p className="body-4">{t("contributed", { quantity: s.contributedQuantity, unit: s.unit, crop: s.crop })}</p>
        <p className="body-4">{t("delivered", { quantity: s.deliveredQuantity, unit: s.unit, price: formatNaira(s.unitKobo) })}</p>
        <p className="body-4 tabular-nums">{t("gross", { amount: formatNaira(s.grossShareKobo) })}</p>
        <p className="body-4 tabular-nums">{t("cut", { percent: formatPercent(s.cutBps), amount: formatNaira(s.cutKobo) })}</p>
        <p className="body-4 tabular-nums">{t("fee", { percent: formatPercent(s.feeBps), amount: formatNaira(s.feeKobo) })}</p>
        <p className="heading-6 tabular-nums">{t("takeHome", { amount: formatNaira(s.takeHomeKobo) })}</p>
      </Card>
      <Card tone="paper" className="flex flex-col gap-2">
        <h2 className="title-2">{t("payouts")}</h2>
        <ul className="flex flex-col gap-1">
          {s.payouts.map((p) => (
            <li key={p.part} className="body-4 tabular-nums">
              {t("payout", { part: p.part, amount: formatNaira(p.amountKobo), status: t(`status.${p.status}`) })}
              {p.paidAt ? ` · ${day.format(new Date(p.paidAt))}` : ""}
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
