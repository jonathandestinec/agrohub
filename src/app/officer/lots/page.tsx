import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
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
  if (actor.role !== "OFFICER") notFound();
  return <ScreeningQueue actor={actor} basePath="/officer/lots" />;
}
