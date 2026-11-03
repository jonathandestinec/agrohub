import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { ButtonLink, PageHeading } from "@/components/ui";

export default function BuyerHomePage() {
  return (
    <Suspense fallback={null}>
      <BuyerHome />
    </Suspense>
  );
}

async function BuyerHome() {
  const actor = await requireActorForPage();
  if (actor.role !== "BUYER") notFound();
  const t = await getTranslations("buyer.home");
  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")}>
        <ButtonLink href="/lots" tone="ink">
          {t("browse")}
        </ButtonLink>
      </PageHeading>
    </main>
  );
}
