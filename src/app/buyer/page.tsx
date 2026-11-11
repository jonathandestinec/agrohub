import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { HomeHeading, HomeShell, HomeSkeleton, TileGrid } from "@/components/home/grid";
import { ButtonLink } from "@/components/ui";
import { buyerHome } from "@/modules/home/service";
import { currentUser } from "@/modules/identity/session";

// The buyer's to-do home: offers to act on, deliveries to confirm and orders on their way.
export default function BuyerHomePage() {
  return (
    <Suspense
      fallback={
        <HomeShell>
          <HomeSkeleton tiles={5} />
        </HomeShell>
      }
    >
      <BuyerHome />
    </Suspense>
  );
}

async function BuyerHome() {
  const actor = await requireActorForPage();
  if (actor.role !== "BUYER") notFound();
  const [tiles, user, t] = await Promise.all([buyerHome(actor), currentUser(), getTranslations("buyer.home")]);

  return (
    <HomeShell>
      <HomeHeading name={user?.name ?? ""}>
        <ButtonLink href="/lots" tone="ink">
          {t("browse")}
        </ButtonLink>
      </HomeHeading>
      <TileGrid tiles={tiles} />
    </HomeShell>
  );
}
