import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { HomeHeading, HomeShell, HomeSkeleton, TileGrid } from "@/components/home/grid";
import { Schedule } from "@/components/home/schedule";
import { ButtonLink } from "@/components/ui";
import { officerHome } from "@/modules/home/service";
import { currentUser } from "@/modules/identity/session";

// The officer's to-do home: what waits on them, and the deliveries coming up.
export default function OfficerHomePage() {
  return (
    <Suspense
      fallback={
        <HomeShell>
          <HomeSkeleton tiles={7} />
        </HomeShell>
      }
    >
      <OfficerHome />
    </Suspense>
  );
}

async function OfficerHome() {
  const actor = await requireActorForPage();
  if (actor.role !== "OFFICER") notFound();
  const [home, user, t] = await Promise.all([officerHome(actor), currentUser(), getTranslations("home.officer")]);

  return (
    <HomeShell>
      <HomeHeading name={user?.name ?? ""} />
      {home.verified ? (
        <>
          <TileGrid tiles={home.tiles} />
          <Schedule schedule={home.schedule} />
        </>
      ) : (
        <div className="flex flex-col items-start gap-4 rounded-inner bg-paper p-4 md:p-6">
          <p role="status" className="title-2">
            {t("onboarding")}
          </p>
          <ButtonLink href="/officer/onboarding" tone="ink">
            {t("onboardingLink")}
          </ButtonLink>
        </div>
      )}
    </HomeShell>
  );
}
