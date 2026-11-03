import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { buttonClass, Card, PageHeading } from "@/components/ui";
import { formatNaira } from "@/lib/money";
import { weekInput } from "@/modules/board/schema";
import { listMarkets, listWeek } from "@/modules/board/service";
import { toWeekKey, weekStart } from "@/modules/board/week";
import { listActiveCatalog } from "@/modules/catalog/service";
import { PriceForm } from "./price-form";

// Board admin home: record a price, and see the chosen week's prices (?week=YYYY-MM-DD).
export default function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  return (
    <Suspense fallback={null}>
      <Board searchParams={searchParams} />
    </Suspense>
  );
}

async function Board({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  const actor = await requireActorForPage();
  if (actor.role !== "BOARD_ADMIN") notFound();
  const t = await getTranslations("board.entry");
  const locale = await getLocale();
  const { week } = await searchParams;
  const thisWeek = toWeekKey(weekStart(new Date()));
  const shown =
    typeof week === "string" && weekInput.safeParse(week).success
      ? toWeekKey(weekStart(new Date(`${week}T12:00:00Z`)))
      : thisWeek;
  const [{ crops, units }, entries, markets] = await Promise.all([
    listActiveCatalog(),
    listWeek(actor, shown),
    listMarkets(actor),
  ]);
  const weekLabel = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${shown}T00:00:00Z`),
  );

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")} />
      <div className="grid gap-2 md:grid-cols-12">
        <Card tone="paper" className="md:col-span-5">
          {crops.length === 0 || units.length === 0 ? (
            <p className="body-3">
              {t("needCatalog")}{" "}
              <Link href="/board/crops" className="underline underline-offset-4">
                {/* Same label as the nav link. */}
                {t("needCatalogLink")}
              </Link>
            </p>
          ) : (
            <PriceForm crops={crops} units={units} markets={markets} weekOf={thisWeek} />
          )}
        </Card>
        <Card tone="paper" className="flex flex-col gap-4 md:col-span-7">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="heading-6">{t("weekHeading", { date: weekLabel })}</h2>
            <form method="get" className="flex items-end gap-2">
              <label htmlFor="week" className="sr-only">
                {t("week")}
              </label>
              <input
                id="week"
                name="week"
                type="date"
                defaultValue={shown}
                className="min-h-11 rounded-input bg-step px-3 body-6 text-ink"
              />
              <button type="submit" className={buttonClass("step")}>
                {t("showWeek")}
              </button>
            </form>
          </div>
          {entries.length === 0 ? (
            <p className="body-3 text-ink-soft">{t("weekEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left body-6">
                <thead className="title-4 text-ink-soft">
                  <tr>
                    <th scope="col" className="py-2 pr-4">{t("crop")}</th>
                    <th scope="col" className="py-2 pr-4">{t("unit")}</th>
                    <th scope="col" className="py-2 pr-4">{t("market")}</th>
                    <th scope="col" className="py-2 text-right">{t("price")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <th scope="row" className="py-2 pr-4 title-4">{e.crop}</th>
                      <td className="py-2 pr-4">{e.unit}</td>
                      <td className="py-2 pr-4 break-words">{e.market}</td>
                      <td className="py-2 text-right tabular-nums">{formatNaira(e.priceKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
