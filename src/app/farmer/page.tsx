import { redirect } from "next/navigation";
import { Suspense } from "react";
import { HomeHeading, HomeShell, HomeSkeleton, TileGrid } from "@/components/home/grid";
import { ForbiddenError } from "@/lib/errors";
import { withNext } from "@/lib/safe-next";
import { farmerHome } from "@/modules/home/service";
import type { Actor } from "@/modules/identity/policies";
import { currentUser, getActor } from "@/modules/identity/session";

// The farmer's to-do home. A pending or removed farmer has no Actor yet, and a person using
// another role has the wrong one: both go to the farm page, which shows their status. So this
// page reads the session itself instead of calling requireActorForPage (which sends a person
// without an Actor to sign-in).
export default function FarmerHomePage() {
  return (
    <Suspense
      fallback={
        <HomeShell>
          <HomeSkeleton tiles={5} />
        </HomeShell>
      }
    >
      <FarmerHome />
    </Suspense>
  );
}

async function FarmerHome() {
  const user = await currentUser();
  if (!user) redirect(withNext("/sign-in", "/farmer"));
  let actor: Actor | null = null;
  try {
    actor = await getActor();
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
  }
  if (!actor || actor.role !== "FARMER") redirect("/farmer/profile");
  const tiles = await farmerHome(actor);

  return (
    <HomeShell>
      <HomeHeading name={user.name} />
      <TileGrid tiles={tiles} />
    </HomeShell>
  );
}
