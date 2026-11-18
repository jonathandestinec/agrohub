import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { Card, PageHeading } from "@/components/ui";
import { getLotFormContext } from "@/modules/catalog/service";
import { STATES } from "@/modules/geo/states";
import { LotForm } from "./lot-form";

export default function NewLotPage() {
  return (
    <Suspense fallback={null}>
      <NewLot />
    </Suspense>
  );
}

async function NewLot() {
  const actor = await requireActorForPage();
  if (actor.role !== "FARMER") notFound();
  const t = await getTranslations("lots");
  const context = await getLotFormContext(actor);

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("new.title")} lead={t("new.lead")} />
      <Card tone="paper">
        {context.blockedBy ? (
          <p role="status" className="body-3">
            {t(`new.blocked.${context.blockedBy}`)}{" "}
            <Link href="/farmer/profile" className="underline underline-offset-4">
              {t("new.goToFarm")}
            </Link>
          </p>
        ) : (
          <LotForm context={context} states={[...STATES]} />
        )}
      </Card>
    </main>
  );
}
