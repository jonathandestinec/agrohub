import Image from "next/image";
import Link from "next/link";
import { formatNaira } from "@/lib/money";
import { EarningsCalculator } from "./_components/earnings-calculator";
import { Reveal, TaglineReveal } from "./_components/motion";
import { ArrowRight, ArrowUpRight, ButtonLink, Check, CropThumb } from "./_components/ui";
import { BOARD, cropById } from "./_lib/data";
import hero from "../../../public/demo/farmer-at-harvest.jpg";
import sky from "../../../public/trees-with-open-sky-in-the-center.png";

const STEPS = [
  { title: "A farmer lists a lot", body: "Crop, quantity, grade and an asking price. A private lowest price stays hidden from every buyer." },
  { title: "An officer approves it", body: "The cooperative's officer checks the lot and its price before any buyer can see it." },
  { title: "The buyer pays in full", body: "Payment goes through Paystack and is held by AgroHub, never by the cooperative or an officer." },
  { title: "Delivery confirmed, everyone paid", body: "When the buyer confirms delivery, the cooperative and each farmer receive their share by bank transfer." },
];

const ROLES = [
  { href: "/demo/market", who: "Buyers", what: "Browse verified lots, make an offer, pay once.", tag: "Market" },
  { href: "/demo/join", who: "Farmers", what: "Join by invite link, then list a harvest and see the earnings first.", tag: "Farm" },
  { href: "/demo/officer", who: "Cooperative officers", what: "Approve lots, answer offers, mark deliveries.", tag: "Cooperative" },
  { href: "/demo/admin", who: "AgroHub admins", what: "Verify each cooperative before it can sell.", tag: "Trust" },
];

const FAQ = [
  { q: "Who holds the buyer's money?", a: "AgroHub holds it in its Paystack balance until delivery is confirmed. No cooperative or officer can hold, delay or redirect it." },
  { q: "When are farmers paid?", a: "As soon as the buyer confirms delivery. If the buyer does not respond, payment is released automatically three days after the officer marks the order delivered." },
  { q: "Can buyers contact farmers directly?", a: "No. Buyers deal with the cooperative through in-app messages. Phone numbers are visible only to AgroHub admins." },
  { q: "What if a buyer offers less than my price?", a: "An officer can accept offers at or above your private lowest price. Below it, you decide. Buyers never learn your lowest price, even when an offer is turned down." },
  { q: "How is a cooperative verified?", a: "Its officer uploads the state registration certificate, by-laws and officer list. An AgroHub admin reviews them, and the cooperative renews them every year." },
  { q: "What does it cost a farmer?", a: "The cooperative's cut and AgroHub's fee, both shown before you agree and locked to your lot once it is approved. This demo uses 5% and 3%." },
];

export default function DemoHome() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <section aria-label="Our promise" className="mx-auto mt-32 max-w-[1000px] px-4 md:mt-48">
        <TaglineReveal
          className="heading-2 md:text-6xl md:leading-none"
          text="A farmer sees exactly what they will earn before they agree to sell, and nobody in between can hold or redirect that money."
        />
      </section>
      <Calculator />
      <Roles />
      <PriceTeaser />
      <Faq />
      <FinalCta />
    </>
  );
}

function Hero() {
  return (
    <section className="grid gap-2 md:grid-cols-12 md:gap-3">
      <div className="flex flex-col justify-between gap-10 rounded-3xl bg-[var(--d-lime)] p-6 text-[var(--d-lime-ink)] md:col-span-7 md:min-h-[640px] md:p-12">
        <p className="rise flex items-center gap-2 title-4">
          <span className="size-2 rounded-full bg-[var(--d-forest)]" aria-hidden="true" />
          For farmer cooperatives in Nigeria
        </p>
        <div>
          <h1 className="rise rise-1 max-w-[680px] heading-1">
            Sell together.<br /> Get paid on delivery.
          </h1>
          <p className="rise rise-2 mt-8 max-w-[560px] title-2 font-normal">
            Verified cooperatives sell their members&apos; harvests to bulk buyers in one catalogue. The buyer pays in
            full upfront, and the payment is held until delivery is confirmed.
          </p>
          <div className="rise rise-3 mt-10 flex flex-wrap items-center gap-4">
            <ButtonLink href="/demo/market" tone="ink" className="min-h-12 pl-6 pr-2">
              Browse harvests for sale
              <span className="flex size-8 items-center justify-center rounded-full bg-[var(--d-lime)] text-[var(--d-lime-ink)]">
                <ArrowRight />
              </span>
            </ButtonLink>
          </div>
        </div>
        <div className="rise rise-4 flex items-center gap-3">
          <div className="flex -space-x-2" aria-hidden="true">
            {["AO", "FA", "MA"].map((i, n) => (
              <span
                key={i}
                className="flex size-9 shrink-0 items-center justify-center rounded-full caption-4 ring-2 ring-[var(--d-lime)]"
                style={{ background: ["var(--d-forest)", "var(--d-ink-2)", "var(--d-paper)"][n], color: n === 2 ? "var(--d-ink)" : "var(--d-paper)" }}
              >
                {i}
              </span>
            ))}
          </div>
          <p className="max-w-[300px] body-5">Every cooperative is checked by AgroHub before it can sell.</p>
        </div>
      </div>

      <div className="relative min-h-[460px] overflow-hidden rounded-3xl md:col-span-5 md:min-h-[640px]">
        <div className="drift absolute inset-0">
          <Image src={hero} alt="A farmer carrying a bundle of harvested rice across a paddy field" fill priority sizes="(min-width: 768px) 42vw, 100vw" className="object-cover object-[62%_center]" placeholder="blur" />
        </div>

        {/* Top-left notch with the cooperative card. */}
        <div className="absolute left-0 top-0 rounded-br-3xl bg-[var(--d-paper)] pb-3 pr-3">
          <div className="flex items-center gap-3 rounded-2xl bg-[var(--d-step)] p-3 pr-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--d-forest)] text-[var(--d-forest-ink)]">
              <Check className="size-5" />
            </span>
            <div>
              <p className="title-4">Verified cooperatives only</p>
              <p className="caption-4 text-[var(--d-ink-2)]">Documents checked by AgroHub</p>
            </div>
          </div>
          <span className="notch-corner left-full top-0" data-at="br" />
          <span className="notch-corner left-0 top-full" data-at="br" />
        </div>

        {/* Live sample lot floating on the photograph. */}
        <Link
          href="/demo/market/lot-1043"
          className="press press-lift absolute bottom-[23%] left-5 flex items-center gap-3 rounded-full bg-[var(--d-paper)]/90 py-2 pl-2 pr-4 backdrop-blur md:left-8"
        >
          <CropThumb crop={cropById("rice")} className="size-8 rounded-full" />
          <span className="body-5">
            Paddy rice, Grade A · <span className="title-4">{formatNaira(7_150_000)}</span> per bag
          </span>
        </Link>
        <p className="absolute bottom-[14%] left-5 flex items-center gap-2 rounded-full bg-[var(--d-lime)] px-4 py-2 body-5 text-[var(--d-lime-ink)] md:left-8">
          <span className="size-2 rounded-full bg-[var(--d-forest)]" aria-hidden="true" />
          Payment held until delivery
        </p>

        {/* Bottom-right notch with the promise to farmers. */}
        <div className="absolute bottom-0 right-0 max-w-[260px] rounded-tl-3xl bg-[var(--d-paper)] pl-4 pt-4">
          <p className="body-5 text-[var(--d-ink-2)]">Farmers see what they take home before they agree to sell.</p>
          <span className="notch-corner bottom-0 right-full" data-at="tl" />
          <span className="notch-corner bottom-full right-0" data-at="tl" />
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section aria-labelledby="how" className="mt-32 px-2 md:mt-48 md:px-6">
      <Reveal className="mx-auto max-w-[680px] text-center">
        <h2 id="how" className="heading-2">How a sale works</h2>
        <p className="mt-6 body-3 text-[var(--d-ink-2)]">
          One catalogue for the whole cooperative, one payment from the buyer, and a share for every farmer who
          contributed.
        </p>
      </Reveal>

      <Reveal className="mt-14 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3" >
        <div className="flex h-28 items-center justify-center rounded-full bg-[var(--d-step)] heading-3 md:h-44 md:text-6xl md:leading-none">Listed</div>
        <div className="relative flex h-28 items-center justify-center overflow-hidden rounded-full md:h-44">
          <Image src={sky} alt="" fill sizes="25vw" className="object-cover" />
          <span className="absolute inset-0 bg-black/55" aria-hidden="true" />
          <span className="relative heading-3 text-white md:text-6xl md:leading-none">Held</span>
        </div>
        <div className="flex h-28 items-center justify-center rounded-full bg-[var(--d-lime)] text-[var(--d-lime-ink)] md:h-44">
          <ArrowRight className="size-12 md:size-20" />
        </div>
        <div className="flex h-28 items-center justify-center rounded-full bg-[var(--d-forest)] heading-3 text-[var(--d-forest-ink)] md:h-44 md:text-6xl md:leading-none">Paid</div>
      </Reveal>

      <Reveal as="ol" className="mt-10 grid gap-3 md:grid-cols-4">
        {STEPS.map((s) => (
          <li key={s.title} className="rounded-3xl bg-[var(--d-step)] p-6">
            <h3 className="heading-6">{s.title}</h3>
            <p className="mt-3 body-3 text-[var(--d-ink-2)]">{s.body}</p>
          </li>
        ))}
      </Reveal>
    </section>
  );
}

function Calculator() {
  return (
    <section aria-labelledby="calc" className="mt-32 grid gap-8 px-2 md:mt-48 md:grid-cols-12 md:px-6">
      <Reveal className="md:col-span-4">
        <h2 id="calc" className="heading-3">Know what you take home before you sell</h2>
        <p className="mt-6 body-3 text-[var(--d-ink-2)]">
          Change the price or the quantity. This is the same breakdown a farmer sees before submitting a lot, and the
          terms are locked once an officer approves it.
        </p>
      </Reveal>
      <Reveal className="md:col-span-8">
        <EarningsCalculator />
      </Reveal>
    </section>
  );
}

function Roles() {
  return (
    <section aria-labelledby="roles" className="mt-32 px-2 md:mt-48 md:px-6">
      <Reveal className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <h2 id="roles" className="max-w-[680px] heading-3">One platform, a screen for every role</h2>
        <p className="max-w-[320px] body-6 text-[var(--d-ink-2)]">Open any of them. Each screen runs on sample data.</p>
      </Reveal>
      <Reveal as="ul" className="mt-10 flex flex-col gap-2">
        {ROLES.map((r) => (
          <li key={r.href}>
            <Link
              href={r.href}
              className="press group grid min-h-20 grid-cols-[1fr_auto] items-center gap-4 rounded-3xl bg-[var(--d-step)] px-6 py-5 hover:bg-[var(--d-step-2)] md:grid-cols-[2fr_1fr_3fr_auto]"
            >
              <span className="heading-5">{r.who}</span>
              <span className="hidden md:block">
                <span className="rounded-full bg-[var(--d-paper)] px-3 py-1 caption-4">{r.tag}</span>
              </span>
              <span className="col-span-2 row-start-2 body-3 text-[var(--d-ink-2)] md:col-span-1 md:row-start-auto">{r.what}</span>
              <span className="col-start-2 row-start-1 flex size-11 items-center justify-center rounded-full bg-[var(--d-paper)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:rotate-45 md:col-start-auto md:row-start-auto">
                <ArrowUpRight />
              </span>
            </Link>
          </li>
        ))}
      </Reveal>
    </section>
  );
}

function PriceTeaser() {
  const rows = BOARD.slice(0, 4);
  return (
    <section aria-labelledby="board" className="mt-32 px-2 md:mt-48 md:px-6">
      <Reveal className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="max-w-[680px]">
          <h2 id="board" className="heading-3">This week&apos;s price board</h2>
          <p className="mt-4 body-3 text-[var(--d-ink-2)]">
            Board admins post weekly prices per crop and market. Farmers price against them, and buyers see them too.
          </p>
        </div>
        <ButtonLink href="/demo/prices" tone="step">
          See every market <ArrowRight />
        </ButtonLink>
      </Reveal>
      <Reveal className="mt-10 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        {rows.map((row, i) => {
          const crop = cropById(row.cropId);
          const m = row.markets[0]!;
          const change = m.thisWeekKobo - m.lastWeekKobo;
          return (
            <Link
              key={row.cropId}
              href="/demo/prices"
              className={`press press-lift group relative isolate flex flex-col justify-between overflow-hidden rounded-3xl p-5 text-white ${i % 2 ? "h-80 md:mt-12" : "h-80"} md:h-[420px]`}
              style={{ background: crop.field }}
            >
              <Image src={crop.photo} alt={crop.alt} fill sizes="(min-width: 768px) 25vw, 50vw" className="-z-10 object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-105" />
              <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <span className="self-end flex size-10 items-center justify-center rounded-full bg-white/85 text-[var(--d-ink)]">
                <ArrowUpRight />
              </span>
              <span>
                <span className="block heading-4">{crop.name}</span>
                <span className="mt-2 block body-5 opacity-90">{m.name}, per {crop.unit}</span>
                <span className="mt-4 flex items-center justify-between gap-2 rounded-full bg-white/85 px-4 py-2 text-[var(--d-ink)]">
                  <span className="title-4">{formatNaira(m.thisWeekKobo)}</span>
                  <span className={`caption-4 ${change >= 0 ? "text-[var(--d-good)]" : "text-[var(--d-bad)]"}`}>
                    {change >= 0 ? "up" : "down"} {formatNaira(Math.abs(change))}
                  </span>
                </span>
              </span>
            </Link>
          );
        })}
      </Reveal>
    </section>
  );
}

function Faq() {
  return (
    <section aria-labelledby="faq" className="mt-32 grid gap-8 px-2 md:mt-48 md:grid-cols-12 md:px-6">
      <Reveal className="md:col-span-4">
        <h2 id="faq" className="heading-3">Questions cooperatives ask</h2>
      </Reveal>
      <Reveal className="flex flex-col gap-2 md:col-span-8">
        {FAQ.map((f) => (
          <details key={f.q} className="group rounded-3xl bg-[var(--d-step)] px-6 open:bg-[var(--d-step-2)]">
            <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 title-2 [&::-webkit-details-marker]:hidden">
              {f.q}
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--d-paper)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-open:rotate-45" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="size-4" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </span>
            </summary>
            <p className="max-w-[60ch] pb-6 body-3 text-[var(--d-ink-2)]">{f.a}</p>
          </details>
        ))}
      </Reveal>
    </section>
  );
}

function FinalCta() {
  return (
    <section aria-labelledby="cta" className="mt-32 md:mt-48">
      <Reveal className="flex flex-col items-start justify-between gap-8 rounded-3xl bg-[var(--d-forest)] p-8 text-[var(--d-forest-ink)] md:flex-row md:items-end md:p-12">
        <h2 id="cta" className="max-w-[680px] heading-2">Bring your cooperative&apos;s next harvest to buyers.</h2>
        <ButtonLink href="/sign-up" tone="lime" className="min-h-12 shrink-0">
          Register your cooperative <ArrowRight />
        </ButtonLink>
      </Reveal>
    </section>
  );
}
