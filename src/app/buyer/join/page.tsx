import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { ButtonLink, Card, PageHeading } from "@/components/ui";
import { withNext } from "@/lib/safe-next";
import { currentUser } from "@/modules/identity/session";
import { JoinForm } from "./join-form";

// Signed out: what buying means and a sign-up link that returns here. Signed in: one button
// that grants the buyer role (identity/service.ts becomeBuyer).
export default function BuyerJoinPage() {
  return (
    <Suspense fallback={null}>
      <BuyerJoin />
    </Suspense>
  );
}

async function BuyerJoin() {
  const t = await getTranslations("buyer.join");
  const user = await currentUser();
  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")} />
      <Card tone="paper">
        <ul className="flex list-disc flex-col gap-2 pl-5 body-4">
          <li>{t("pointCooperatives")}</li>
          <li>{t("pointOffers")}</li>
          <li>{t("pointHeld")}</li>
        </ul>
      </Card>
      {user ? (
        <JoinForm />
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <ButtonLink href={withNext("/sign-up", "/buyer/join")} tone="ink" size="lg">
            {t("createAccount")}
          </ButtonLink>
          <Link href={withNext("/sign-in", "/buyer/join")} className="underline underline-offset-2">
            {t("signIn")}
          </Link>
        </div>
      )}
    </main>
  );
}
