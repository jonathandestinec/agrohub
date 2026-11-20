import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { LiveRefresh } from "@/components/live-refresh";
import { screeningVersion } from "@/modules/catalog/service";
import { ScreeningQueue } from "@/components/lots/screening-pages";

export default function LotQueuePage() {
  return (
    <Suspense fallback={null}>
      <Queue />
    </Suspense>
  );
}

async function Queue() {
  const actor = await requireActorForPage();
  if (actor.role !== "ADMIN") notFound();
  const version = await screeningVersion(actor);
  return (
    <>
      <LiveRefresh topic="queue:screening" intervalMs={60_000} initialVersion={version} />
      <ScreeningQueue actor={actor} basePath="/admin/lots" />
    </>
  );
}
