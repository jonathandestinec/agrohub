import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { AuthCard } from "@/components/auth-ui";
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
    <AuthCard title={t("title")}>
      <p className="text-base text-muted">{t("intro")}</p>
      {cooperative.status !== "VERIFIED" ? (
        <p
          role="status"
          className="rounded-md border border-border bg-surface px-3 py-3 text-base"
        >
          {t("notVerified")}
        </p>
      ) : null}
      <InvitesPanel initialUrl={url} />
    </AuthCard>
  );
}
