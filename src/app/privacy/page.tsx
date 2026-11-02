import { getTranslations } from "next-intl/server";

// Placeholder until the privacy notice is written.
export default async function PrivacyPage() {
  const t = await getTranslations("privacy");
  return (
    <main id="main" className="flex-1 rounded-panel bg-step px-6 py-10 md:px-12 md:py-16">
      <div className="max-w-[65ch]">
        <h1 className="heading-3 break-words">{t("title")}</h1>
        <p className="mt-4 body-3">{t("comingSoon")}</p>
      </div>
    </main>
  );
}
