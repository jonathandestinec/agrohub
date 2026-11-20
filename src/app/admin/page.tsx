import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { HomeHeading, HomeShell, HomeSkeleton, TileGrid } from "@/components/home/grid";
import { HomeLive } from "@/components/home-live";
import { adminHome } from "@/modules/home/service";
import { currentUser } from "@/modules/identity/session";
import { alertsVersion } from "@/modules/notifications/service";

// The admin's to-do home: every queue that waits for a decision.
export default function AdminHomePage() {
  return (
    <Suspense
      fallback={
        <HomeShell>
          <HomeSkeleton tiles={7} />
        </HomeShell>
      }
    >
      <AdminHome />
    </Suspense>
  );
}

async function AdminHome() {
  const actor = await requireActorForPage();
  if (actor.role !== "ADMIN") notFound();
  const alertsAt = await alertsVersion(actor);
  const [tiles, user] = await Promise.all([adminHome(actor), currentUser()]);

  return (
    <HomeShell>
      <HomeLive initialVersion={alertsAt} />
      <HomeHeading name={user?.name ?? ""} />
      <TileGrid tiles={tiles} />
    </HomeShell>
  );
}
