import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { PageHeading } from "@/components/ui";
import { createInviteLink } from "@/modules/cooperatives/invites";
import { getOwnCooperative } from "@/modules/cooperatives/service";
import { InvitesPanel } from "./invites-panel";

export default function InvitesPage() {
  return (
    <Suspense fallback={null}>
      <Invites />
    </Suspense>
  );
}

async function Invites() {
  const actor = await requireActorForPage();
  const cooperativeId = actor.cooperativeId;
  if (actor.role !== "OFFICER" || cooperativeId === null) notFound();
  const { url } = await createInviteLink(actor, cooperativeId);
  // Only the status is used, to tell the officer that joining waits for verification.
  const { cooperative } = await getOwnCooperative(actor);
  const t = await getTranslations("officer.invites");

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("intro")} />
      {cooperative.status !== "VERIFIED" ? (
        <p
          role="status"
          className="rounded-inner bg-warn-soft p-4 body-3 md:p-6"
        >
          {t("notVerified")}
        </p>
      ) : null}
      <div className="rounded-inner bg-paper p-4 md:p-6">
        <InvitesPanel initialUrl={url} />
      </div>
    </main>
  );
}
