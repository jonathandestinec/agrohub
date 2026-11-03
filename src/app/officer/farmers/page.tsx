import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { Card, PageHeading } from "@/components/ui";
import { listActiveCatalog, listCooperativeCatalogRequests } from "@/modules/catalog/service";
import { CatalogRequestsPanel } from "./catalog-requests-panel";
import { listActiveFarmers, listPendingFarmers } from "@/modules/farmers/service";
import { FarmersPanel } from "./farmers-panel";

export default function OfficerFarmersPage() {
  return (
    <Suspense fallback={null}>
      <OfficerFarmers />
    </Suspense>
  );
}

async function OfficerFarmers() {
  const actor = await requireActorForPage();
  const cooperativeId = actor.cooperativeId;
  if (actor.role !== "OFFICER" || cooperativeId === null) notFound();
  const [pending, active, requests, catalog] = await Promise.all([
    listPendingFarmers(actor, cooperativeId),
    listActiveFarmers(actor, cooperativeId),
    listCooperativeCatalogRequests(actor),
    listActiveCatalog(),
  ]);
  const t = await getTranslations("officer.farmers");

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("intro")} />
      <FarmersPanel pending={pending} active={active} />
      <Card tone="paper">
        <CatalogRequestsPanel requests={requests} crops={catalog.crops} units={catalog.units} />
      </Card>
    </main>
  );
}
