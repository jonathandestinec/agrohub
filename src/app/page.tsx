import { useTranslations } from "next-intl";
import { Chip } from "@/components/ui";

export default function Home() {
  const t = useTranslations("home");
  const app = useTranslations("app");
  return (
    <main id="main" className="flex-1 rounded-panel bg-lime px-6 py-12 text-lime-ink md:px-12 md:py-20">
      <div className="max-w-[720px]">
        <h1 className="heading-1 break-words">{t("welcome")}</h1>
        <p className="mt-6 max-w-[56ch] title-2">{t("intro")}</p>
        <div className="mt-8">
          <Chip tone="forest">{app("tagline")}</Chip>
        </div>
      </div>
    </main>
  );
}
