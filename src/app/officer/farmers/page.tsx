import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { AuthCard } from "@/components/auth-ui";
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
    <AuthCard title={t("title")}>
      <p className="text-base text-muted">{t("intro")}</p>
      <FarmersPanel pending={pending} active={active} />
    </AuthCard>
  );
}
