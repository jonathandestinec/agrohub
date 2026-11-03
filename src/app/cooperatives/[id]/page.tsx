import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { PublicLotCard } from "@/components/lots/public-lot-card";
import { Chip, PageHeading } from "@/components/ui";
import { NotFoundError } from "@/lib/errors";
import { parseLotFilters, searchLiveLots } from "@/modules/catalog/service";
import { getPublicCooperative, type PublicCooperative } from "@/modules/cooperatives/service";

// Public: a verified cooperative and its live lots. Only PublicCooperative and PublicLot reach
// this page: no registration number, bank data, officers or documents.
async function findCooperative(id: string): Promise<PublicCooperative | null> {
  try {
    return await getPublicCooperative(id);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<"/cooperatives/[id]">): Promise<Metadata> {
  const { id } = await params;
  await connection();
  const cooperative = await findCooperative(id);
  if (!cooperative) return {};
  const t = await getTranslations("publicCooperative.meta");
  return {
    title: t("title", { name: cooperative.name }),
    description: t("description", { name: cooperative.name, lga: cooperative.lga, state: cooperative.state }),
    alternates: { canonical: `/cooperatives/${cooperative.id}` },
  };
}

export default function CooperativePage({ params }: PageProps<"/cooperatives/[id]">) {
  return (
    <Suspense fallback={null}>
      <CooperativeDetail params={params} />
    </Suspense>
  );
}

async function CooperativeDetail({ params }: { params: PageProps<"/cooperatives/[id]">["params"] }) {
  const { id } = await params;
  await connection();
  const cooperative = await findCooperative(id);
  if (!cooperative) notFound();
  const t = await getTranslations("publicCooperative");
  const locale = await getLocale();
  const { lots } = await searchLiveLots(parseLotFilters({ cooperativeId: cooperative.id }));
  const since = cooperative.verifiedSince
    ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${cooperative.verifiedSince}-01T00:00:00Z`),
      )
    : null;

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={cooperative.name} lead={t("location", { lga: cooperative.lga, state: cooperative.state })}>
        <Chip tone="lime">{since ? t("verifiedSince", { date: since }) : t("verified")}</Chip>
      </PageHeading>
      <section aria-labelledby="lots-heading" className="flex flex-col gap-3">
        <h2 id="lots-heading" className="heading-6">
          {t("lotsHeading")}
        </h2>
        {lots.length === 0 ? (
          <p className="body-4 text-ink-soft">{t("noLots")}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {lots.map((lot) => (
              <li key={lot.id}>
                <PublicLotCard lot={lot} showCooperative={false} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
