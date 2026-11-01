import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-ui";
import { withNext } from "@/lib/safe-next";
import { getOwnFarmerOverview } from "@/modules/farmers/service";
import { currentUser } from "@/modules/identity/session";
import { FarmerBankSection } from "./bank-section";

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
        <p className="text-base">{t("notJoined")}</p>
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

  return (
    <AuthCard title={membership.cooperativeName}>
      <p
        role="status"
        className="rounded-md border border-border bg-surface px-3 py-3 text-base"
      >
        {status}
      </p>
      <section className="flex flex-col gap-2">
        <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">
          {t("profileHeading")}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
          <dt className="text-muted">{t("farmSize")}</dt>
          <dd>{t("hectares", { size: profile.farmSizeHectares })}</dd>
          <dt className="text-muted">{t("crops")}</dt>
          <dd>{profile.crops.join(", ")}</dd>
          <dt className="text-muted">{t("location")}</dt>
          <dd>{t("place", { lga: profile.lga, state: profile.state })}</dd>
        </dl>
      </section>
      <FarmerBankSection bank={overview.bank} canChange={holding} />
    </AuthCard>
  );
}
