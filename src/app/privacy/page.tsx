import { getTranslations } from "next-intl/server";

// Placeholder until the privacy notice is written.
export default async function PrivacyPage() {
  const t = await getTranslations("privacy");
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="font-[family-name:var(--font-heading)] text-2xl font-semibold">
        {t("title")}
      </h1>
      <p className="mt-3 text-muted">{t("comingSoon")}</p>
    </main>
  );
}
