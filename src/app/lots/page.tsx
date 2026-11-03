import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PublicLotCard } from "@/components/lots/public-lot-card";
import { PageHeading, buttonClass } from "@/components/ui";
import { listActiveCatalog, parseLotFilters, searchLiveLots } from "@/modules/catalog/service";
import { LotFiltersForm } from "./filters";

// Public: buyers and signed-out visitors search live lots at the asking price. Only PublicLot
// reaches this page, so no floor, farmer or screening detail can appear here.
export default function LotsPage({ searchParams }: PageProps<"/lots">) {
  return (
    <Suspense fallback={null}>
      <Lots searchParams={searchParams} />
    </Suspense>
  );
}

function pageHref(params: Record<string, string | string[] | undefined>, page: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const one = Array.isArray(value) ? value[0] : value;
    if (one && key !== "page") query.set(key, one);
  }
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `/lots?${text}` : "/lots";
}

async function Lots({ searchParams }: { searchParams: PageProps<"/lots">["searchParams"] }) {
  const t = await getTranslations("publicLots");
  // Rendered per request: a lot hides itself once its available-until day has passed.
  await connection();
  const params = await searchParams;
  const filters = parseLotFilters(params);
  const [{ lots, page, hasMore }, { crops }] = await Promise.all([searchLiveLots(filters), listActiveCatalog()]);
  const filtered = Object.keys(filters).some((key) => key !== "sort" && key !== "page");

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")} />
      <LotFiltersForm filters={filters} crops={crops} />
      {lots.length === 0 ? (
        <p className="body-3 text-ink-soft">{filtered ? t("emptyFiltered") : t("empty")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {lots.map((lot) => (
            <li key={lot.id}>
              <PublicLotCard lot={lot} />
            </li>
          ))}
        </ul>
      )}
      {page > 1 || hasMore ? (
        <nav aria-label={t("pagesLabel")} className="flex flex-wrap gap-2">
          {page > 1 ? (
            <Link href={pageHref(params, page - 1)} className={buttonClass("paper")}>
              {t("previous")}
            </Link>
          ) : null}
          {hasMore ? (
            <Link href={pageHref(params, page + 1)} className={buttonClass("paper")}>
              {t("next")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
