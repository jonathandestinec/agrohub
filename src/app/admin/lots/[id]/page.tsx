import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { LiveRefresh } from "@/components/live-refresh";
import { screeningVersion } from "@/modules/catalog/service";
import { ScreeningLotPage } from "@/components/lots/screening-pages";

export default function ScreenLotPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <ScreenLot params={params} />
    </Suspense>
  );
}

async function ScreenLot({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActorForPage();
  if (actor.role !== "ADMIN") notFound();
  const { id } = await params;
  const version = await screeningVersion(actor);
  return (
    <>
      <LiveRefresh topic="queue:screening" intervalMs={60_000} initialVersion={version} />
      <ScreeningLotPage actor={actor} lotId={id} />
    </>
  );
}
