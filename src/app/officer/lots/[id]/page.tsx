import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { LiveRefresh } from "@/components/live-refresh";
import { screeningVersion } from "@/modules/catalog/service";
import { getTranslations } from "next-intl/server";
import { ScreeningLotPage } from "@/components/lots/screening-pages";
import { OpenThreadButton } from "@/components/messages/open-thread-button";

export default function ScreenLotPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <ScreenLot params={params} />
    </Suspense>
  );
}

async function ScreenLot({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActorForPage();
  if (actor.role !== "OFFICER") notFound();
  const { id } = await params;
  const t = await getTranslations("offers.officer");
  const version = await screeningVersion(actor);
  return (
    <>
      <LiveRefresh topic="queue:screening" intervalMs={30_000} initialVersion={version} />
      <ScreeningLotPage actor={actor} lotId={id} extra={<OpenThreadButton lotId={id} label={t("messageFarmer")} />} />
    </>
  );
}
