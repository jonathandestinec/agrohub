import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { EarningsCalculator } from "@/components/landing/earnings-calculator";
import { Reveal, TaglineReveal } from "@/components/landing/motion";
import { ArrowRight, ButtonLink, Check } from "@/components/ui";
import hero from "../../public/photos/farmer-at-harvest.jpg";
import sky from "../../public/photos/sky.png";

// The public landing page, ported from the approved /demo landing. Sample lots and the
// price board are left out until those features exist; every action leads to sign-up.

const STEPS = ["list", "approve", "pay", "deliver"] as const;
const ROLES = ["buyers", "farmers", "officers", "admins"] as const;
const FAQ = ["holds", "when", "contact", "lower", "verified", "cost"] as const;

export default async function Home() {
  const t = await getTranslations("landing");
  return (
    <main id="main" className="flex-1">
      <Hero />
      <HowItWorks />
      <section aria-label={t("promiseLabel")} className="mx-auto mt-32 max-w-[1000px] px-4 md:mt-48">
        <TaglineReveal className="heading-2 md:text-6xl md:leading-none" text={t("promise")} />
      </section>
      <Calculator />
      <Roles />
      <Faq />
      <FinalCta />
    </main>
  );
}

async function Hero() {
  const t = await getTranslations("landing.hero");
  return (
    <section className="grid gap-2 md:grid-cols-12 md:gap-3">
      <div className="flex flex-col justify-between gap-10 rounded-panel bg-lime p-6 text-lime-ink md:col-span-7 md:min-h-[640px] md:p-12">
        <p className="rise flex items-center gap-2 title-4">
          <span className="size-2 rounded-full bg-forest" aria-hidden="true" />
          {t("eyebrow")}
        </p>
        <div>
          <h1 className="rise rise-1 max-w-[680px] heading-1">
            {t("titleLine1")}
            <br /> {t("titleLine2")}
          </h1>
          <p className="rise rise-2 mt-8 max-w-[560px] title-2 font-normal">{t("lead")}</p>
          <div className="rise rise-3 mt-10 flex flex-wrap items-center gap-3">
            <ButtonLink href="/sign-up" tone="ink" size="lg" className="pl-6 pr-2">
              {t("cta")}
              <span className="flex size-8 items-center justify-center rounded-full bg-lime text-lime-ink">
                <ArrowRight />
              </span>
            </ButtonLink>
            <ButtonLink href="/sign-in" tone="paper" size="lg">
              {t("signIn")}
            </ButtonLink>
          </div>
        </div>
        <p className="rise rise-4 max-w-[300px] body-5">{t("checked")}</p>
      </div>

      <div className="relative min-h-[460px] overflow-hidden rounded-panel md:col-span-5 md:min-h-[640px]">
        <div className="drift absolute inset-0">
          <Image
            src={hero}
            alt={t("photoAlt")}
            fill
            priority
            sizes="(min-width: 768px) 42vw, 100vw"
            className="object-cover object-[62%_center]"
            placeholder="blur"
          />
        </div>

        {/* Top-left notch with the verification promise. */}
        <div className="absolute left-0 top-0 rounded-br-3xl bg-paper pb-3 pr-3">
          <div className="flex items-center gap-3 rounded-2xl bg-step p-3 pr-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-forest text-forest-ink">
              <Check className="size-5" />
            </span>
            <div>
              <p className="title-4">{t("verifiedTitle")}</p>
              <p className="caption-4 text-ink-soft">{t("verifiedNote")}</p>
            </div>
          </div>
          <span className="notch-corner left-full top-0" data-at="br" />
          <span className="notch-corner left-0 top-full" data-at="br" />
        </div>

        {/* Bottom-right notch with the promise to farmers. */}
        <div className="absolute bottom-0 right-0 max-w-[260px] rounded-tl-3xl bg-paper pl-4 pt-4">
          <p className="body-5 text-ink-soft">{t("takeHomeNote")}</p>
          <span className="notch-corner bottom-0 right-full" data-at="tl" />
          <span className="notch-corner bottom-full right-0" data-at="tl" />
        </div>
      </div>
    </section>
  );
}

async function HowItWorks() {
  const t = await getTranslations("landing.how");
  return (
    <section aria-labelledby="how" className="mt-32 px-2 md:mt-48 md:px-6">
      <Reveal className="mx-auto max-w-[680px] text-center">
        <h2 id="how" className="heading-2">
          {t("title")}
        </h2>
        <p className="mt-6 body-3 text-ink-soft">{t("lead")}</p>
      </Reveal>
      <Reveal className="mt-14 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <div className="flex h-28 items-center justify-center rounded-full bg-step heading-3 md:h-44 md:text-6xl md:leading-none">
          {t("listed")}
        </div>
        <div className="relative flex h-28 items-center justify-center overflow-hidden rounded-full md:h-44">
          <Image src={sky} alt="" fill sizes="25vw" className="object-cover" />
          <span className="absolute inset-0 bg-black/55" aria-hidden="true" />
          <span className="relative heading-3 text-paper md:text-6xl md:leading-none">{t("held")}</span>
        </div>
        <div className="flex h-28 items-center justify-center rounded-full bg-lime text-lime-ink md:h-44">
          <ArrowRight className="size-12 md:size-20" />
        </div>
        <div className="flex h-28 items-center justify-center rounded-full bg-forest heading-3 text-forest-ink md:h-44 md:text-6xl md:leading-none">
          {t("paid")}
        </div>
      </Reveal>
      <Reveal as="ol" className="mt-10 grid gap-3 md:grid-cols-4">
        {STEPS.map((s) => (
          <li key={s} className="rounded-panel bg-step p-6">
            <h3 className="heading-6">{t(`steps.${s}.title`)}</h3>
            <p className="mt-3 body-3 text-ink-soft">{t(`steps.${s}.body`)}</p>
          </li>
        ))}
      </Reveal>
    </section>
  );
}

async function Calculator() {
  const t = await getTranslations("landing.calc");
  return (
    <section aria-labelledby="calc" className="mt-32 grid gap-8 px-2 md:mt-48 md:grid-cols-12 md:px-6">
      <Reveal className="md:col-span-4">
        <h2 id="calc" className="heading-3">
          {t("title")}
        </h2>
        <p className="mt-6 body-3 text-ink-soft">{t("lead")}</p>
      </Reveal>
      <Reveal className="min-w-0 md:col-span-8">
        <EarningsCalculator />
      </Reveal>
    </section>
  );
}

async function Roles() {
  const t = await getTranslations("landing.roles");
  return (
    <section aria-labelledby="roles" className="mt-32 px-2 md:mt-48 md:px-6">
      <Reveal className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <h2 id="roles" className="max-w-[680px] heading-3">
          {t("title")}
        </h2>
        <p className="max-w-[320px] body-6 text-ink-soft">{t("lead")}</p>
      </Reveal>
      <Reveal as="ul" className="mt-10 flex flex-col gap-2">
        {ROLES.map((r) => (
          <li
            key={r}
            className="grid min-h-20 grid-cols-[1fr_auto] items-center gap-4 rounded-panel bg-step px-6 py-5 md:grid-cols-[2fr_3fr_auto]"
          >
            <span className="heading-5">{t(`${r}.who`)}</span>
            <span className="col-span-2 row-start-2 body-3 text-ink-soft md:col-span-1 md:row-start-auto">{t(`${r}.what`)}</span>
            <span className="col-start-2 row-start-1 rounded-full bg-paper px-3 py-1 caption-4 md:col-start-auto md:row-start-auto">
              {t(`${r}.tag`)}
            </span>
          </li>
        ))}
      </Reveal>
    </section>
  );
}

async function Faq() {
  const t = await getTranslations("landing.faq");
  return (
    <section aria-labelledby="faq" className="mt-32 grid gap-8 px-2 md:mt-48 md:grid-cols-12 md:px-6">
      <Reveal className="md:col-span-4">
        <h2 id="faq" className="heading-3">
          {t("title")}
        </h2>
      </Reveal>
      <Reveal className="flex flex-col gap-2 md:col-span-8">
        {FAQ.map((f) => (
          <details key={f} className="group rounded-panel bg-step px-6 open:bg-step-deep">
            <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 title-2 [&::-webkit-details-marker]:hidden">
              {t(`${f}.q`)}
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper transition-transform duration-500 ease-[var(--ease)] group-open:rotate-45"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" className="size-4" fill="none">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
            </summary>
            <p className="max-w-[60ch] pb-6 body-3 text-ink-soft">{t(`${f}.a`)}</p>
          </details>
        ))}
      </Reveal>
    </section>
  );
}

async function FinalCta() {
  const t = await getTranslations("landing.cta");
  return (
    <section aria-labelledby="cta" className="mt-32 md:mt-48">
      <Reveal className="flex flex-col items-start justify-between gap-8 rounded-panel bg-forest p-8 text-forest-ink md:flex-row md:items-end md:p-12">
        <h2 id="cta" className="max-w-[680px] heading-2">
          {t("title")}
        </h2>
        <ButtonLink href="/sign-up" tone="lime" size="lg" className="shrink-0">
          {t("button")} <ArrowRight />
        </ButtonLink>
      </Reveal>
    </section>
  );
}
