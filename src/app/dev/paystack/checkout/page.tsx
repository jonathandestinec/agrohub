import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Button, Card, PageHeading } from "@/components/ui";
import { formatNaira } from "@/lib/money";
import { fakeCheckoutDetails } from "@/modules/payments/service";
import { settleFakeCheckoutAction } from "./actions";

// Local development only: stands in for Paystack's checkout page when the fake Paystack is in
// use, so the journey can be tried end to end without money. A 404 anywhere else.
export default function DevCheckoutPage({ searchParams }: PageProps<"/dev/paystack/checkout">) {
  return (
    <Suspense fallback={null}>
      <DevCheckout searchParams={searchParams} />
    </Suspense>
  );
}

async function DevCheckout({ searchParams }: { searchParams: PageProps<"/dev/paystack/checkout">["searchParams"] }) {
  const { reference } = await searchParams;
  if (typeof reference !== "string") notFound();
  const details = await fakeCheckoutDetails(reference);
  if (!details) notFound();
  const t = await getTranslations("orders.dev");
  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")} />
      <Card tone="paper" className="flex flex-col gap-3">
        <p className="heading-6 tabular-nums">{t("amount", { amount: formatNaira(details.amountKobo) })}</p>
        <form action={settleFakeCheckoutAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="reference" value={reference} />
          <Button type="submit" name="outcome" value="success" tone="ink">
            {t("pay")}
          </Button>
          <Button type="submit" name="outcome" value="failed">
            {t("fail")}
          </Button>
        </form>
      </Card>
    </main>
  );
}
