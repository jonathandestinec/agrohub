import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireActorForPage } from "@/app/(auth)/require-actor-page";
import { Card, PageHeading } from "@/components/ui";
import { getPlatformSettings } from "@/modules/settings/service";
import { SettingsForm } from "./settings-form";

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  const actor = await requireActorForPage();
  if (actor.role !== "ADMIN") notFound();
  const t = await getTranslations("admin.settings");
  const settings = await getPlatformSettings();

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} />
      <p className="body-3 max-w-prose text-ink-soft">{t("intro")}</p>
      <Card>
        <SettingsForm settings={settings} />
      </Card>
    </main>
  );
}
