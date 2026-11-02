import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import { DemoNav } from "./_components/demo-nav";
import { PHOTO_CREDITS } from "./_lib/data";
import "./demo.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-demo", display: "swap" });

export const metadata: Metadata = {
  title: { default: "AgroHub: cooperatives selling harvests together", template: "%s · AgroHub demo" },
  description:
    "Verified farmer cooperatives sell harvests to bulk buyers. The buyer pays upfront and the payment is held until delivery is confirmed.",
  robots: { index: false, follow: false },
  openGraph: { images: ["/trees-with-open-sky-in-the-center.png"] },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-demo="" className={`${geist.variable} flex-1`}>
      <a
        href="#demo-main"
        className="sr-only z-50 rounded-full bg-[var(--d-ink)] px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <div className="mx-auto w-full max-w-[1360px] p-2 md:p-4">
        <div className="rounded-[32px] bg-[var(--d-paper)] p-2 md:p-3">
          <DemoNav />
          <main id="demo-main" className="mt-2">
            {children}
          </main>
          <DemoFooter />
        </div>
      </div>
    </div>
  );
}

function DemoFooter() {
  return (
    <footer className="mt-24 rounded-3xl bg-[var(--d-step)] px-6 pb-6 pt-12 md:px-10 md:pt-16">
      <div className="flex flex-col justify-between gap-8 md:flex-row">
        <p className="max-w-md body-3 text-[var(--d-ink-2)]">
          This is a working demo with sample cooperatives, farmers and prices. No real money moves on these screens.
        </p>
        <ul className="flex flex-wrap gap-2">
          {[
            { href: "/demo/market", label: "Market" },
            { href: "/demo/prices", label: "Price board" },
            { href: "/privacy", label: "Privacy notice" },
            { href: "/sign-in", label: "Sign in to the live app" },
          ].map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="press flex min-h-11 items-center rounded-full bg-[var(--d-paper)] px-4 title-4 hover:bg-[var(--d-step-2)]">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-10 max-w-4xl caption-2 text-[var(--d-ink-2)]">
        Photographs from Wikimedia Commons:{" "}
        {PHOTO_CREDITS.filter((c) => c.url).map((c, i, all) => (
          <span key={c.url}>
            <a href={c.url} className="underline underline-offset-2 hover:text-[var(--d-ink)]" target="_blank" rel="noreferrer">
              {c.what}
            </a>{" "}
            by {c.by} ({c.license}){i < all.length - 1 ? "; " : "."}
          </span>
        ))}{" "}
        Licences: <a href="https://creativecommons.org/licenses/by-sa/4.0/" className="underline underline-offset-2" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.
      </p>
      <p aria-hidden="true" className="mt-12 select-none text-[22vw] font-semibold leading-none tracking-[-0.06em] text-[var(--d-ink)] md:text-[17vw] xl:text-[15rem]">
        AgroHub
      </p>
    </footer>
  );
}
