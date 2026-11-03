import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { Card, PageHeading } from "@/components/ui";
import { listCatalog, listForwardedCatalogRequests } from "@/modules/catalog/service";
import { RequestsPanel } from "./requests-panel";
import { CatalogPanel } from "./catalog-panel";

export default function CropsPage() {
  return (
    <Suspense fallback={null}>
      <Crops />
    </Suspense>
  );
}

async function Crops() {
  const actor = await requireActorForPage();
  if (actor.role !== "BOARD_ADMIN") notFound();
  const t = await getTranslations("board.crops");
  const [{ crops, units }, requests] = await Promise.all([
    listCatalog(actor),
    listForwardedCatalogRequests(actor),
  ]);

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")} />
      <Card tone="paper">
        <RequestsPanel groups={requests} />
      </Card>
      <div className="grid gap-2 md:grid-cols-2">
        <Card tone="paper">
          <CatalogPanel kind="crop" items={crops} />
        </Card>
        <Card tone="paper">
          <CatalogPanel kind="unit" items={units} />
        </Card>
      </div>
    </main>
  );
}
