import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Card, Chip, PageHeading } from "@/components/ui";
import { buttonClass } from "@/components/ui/button";
import { withNext } from "@/lib/safe-next";
import { getOwnProfile } from "@/modules/identity/service";
import { currentUser } from "@/modules/identity/session";
import { toOwnProfileView } from "@/modules/identity/views";

// Read-only: who is signed in. Any signed-in person, with or without an active membership.
// The only change offered is the existing name-change request.
export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <Account />
    </Suspense>
  );
}

async function Account() {
  const user = await currentUser();
  if (!user) redirect(withNext("/sign-in", "/account"));
  const t = await getTranslations("profile");
  const roles = await getTranslations("roles");
  const profile = toOwnProfileView(await getOwnProfile(user));

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")}>
        <Link href="/account/name" className={buttonClass("paper")}>
          {t("changeName")}
        </Link>
      </PageHeading>
      <div className="grid gap-2 md:grid-cols-12">
        <Card tone="paper" className="md:col-span-6">
          <dl className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <dt className="body-6 text-ink-soft">{t("name")}</dt>
              <dd className="title-2 break-words">{profile.name}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="body-6 text-ink-soft">{t("email")}</dt>
              <dd className="title-2 break-all">{profile.email}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="body-6 text-ink-soft">{t("phone")}</dt>
              <dd className="title-2 break-words">{profile.phone ?? t("noPhone")}</dd>
            </div>
          </dl>
        </Card>
        <Card tone="paper" className="md:col-span-6">
          <h2 className="body-6 text-ink-soft">{t("roles")}</h2>
          {profile.memberships.length === 0 ? (
            <p className="mt-2 body-3">{t("noRoles")}</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-3">
              {profile.memberships.map((m) => (
                <li key={`${m.role}-${m.cooperativeName ?? ""}-${m.status}`} className="flex flex-col gap-1">
                  <span className="title-2">{roles(m.role)}</span>
                  {m.cooperativeName ? (
                    <span className="body-6 text-ink-soft">{t("cooperative", { name: m.cooperativeName })}</span>
                  ) : null}
                  {m.status === "PENDING" ? (
                    <span>
                      <Chip tone="warn">{t("waiting")}</Chip>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
