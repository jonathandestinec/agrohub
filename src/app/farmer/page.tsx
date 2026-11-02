import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-ui";
import { Card, Chip, PageHeading } from "@/components/ui";
import { withNext } from "@/lib/safe-next";
import { getOwnFarmerOverview } from "@/modules/farmers/service";
import { currentUser } from "@/modules/identity/session";
import { FarmerBankSection } from "./bank-section";
import { LeaveSection } from "./leave-section";

// A PENDING farmer has no Actor yet, so this page works from the signed-in user and the
// self-scoped farmer overview.
export default function FarmerPage() {
  return (
    <Suspense fallback={null}>
      <FarmerHome />
    </Suspense>
  );
}

async function FarmerHome() {
  const user = await currentUser();
  if (!user) redirect(withNext("/sign-in", "/farmer"));
  const t = await getTranslations("farmer.home");
  const overview = await getOwnFarmerOverview(user);
  const { membership, profile } = overview;

  if (!membership || !profile) {
    return (
      <AuthCard title={t("title")}>
        <p className="body-3">{t("notJoined")}</p>
      </AuthCard>
    );
  }

  const holding = membership.status === "PENDING" || membership.status === "ACTIVE";
  const status = {
    PENDING: t("status.PENDING"),
    ACTIVE: t("status.ACTIVE"),
    LEFT: t("status.LEFT"),
    REMOVED: t("status.REMOVED"),
  }[membership.status];
  const chipTone = ({ PENDING: "warn", ACTIVE: "forest", LEFT: "paper", REMOVED: "paper" } as const)[
    membership.status
  ];

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={membership.cooperativeName}>
        <Chip tone={chipTone}>{t(`chip.${membership.status}`)}</Chip>
      </PageHeading>
      <p role="status" className="rounded-inner bg-paper p-4 body-3 md:p-6">
        {status}
      </p>
      <div className="grid gap-2 md:grid-cols-12">
        <Card tone="paper" className="md:col-span-5">
          <section className="flex flex-col gap-4">
            <h2 className="heading-6">{t("profileHeading")}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
              <dt className="body-6 text-ink-soft">{t("farmSize")}</dt>
              <dd className="title-3">{t("hectares", { size: profile.farmSizeHectares })}</dd>
              <dt className="body-6 text-ink-soft">{t("crops")}</dt>
              <dd className="title-3 break-words">{profile.crops.join(", ")}</dd>
              <dt className="body-6 text-ink-soft">{t("location")}</dt>
              <dd className="title-3">{t("place", { lga: profile.lga, state: profile.state })}</dd>
            </dl>
          </section>
        </Card>
        <div className="flex flex-col gap-2 md:col-span-7">
          <Card tone="paper">
            <FarmerBankSection bank={overview.bank} canChange={holding} />
          </Card>
          {membership.status === "ACTIVE" ? (
            <Card tone="paper">
              <LeaveSection />
            </Card>
          ) : null}
        </div>
      </div>
    </main>
  );
}
