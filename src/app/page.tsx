import { useTranslations } from "next-intl";

export default function Home() {
  const t = useTranslations("home");
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="font-[family-name:var(--font-heading)] text-2xl font-semibold">
        {t("welcome")}
      </h1>
      <p className="mt-3 text-muted">{t("intro")}</p>
    </main>
  );
}
