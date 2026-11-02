import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { PageHeading } from "@/components/ui";
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
  const [pending, active] = await Promise.all([
    listPendingFarmers(actor, cooperativeId),
    listActiveFarmers(actor, cooperativeId),
  ]);
  const t = await getTranslations("officer.farmers");

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("intro")} />
      <FarmersPanel pending={pending} active={active} />
    </main>
  );
}
