import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
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
  return <ScreeningLotPage actor={actor} lotId={id} />;
}
