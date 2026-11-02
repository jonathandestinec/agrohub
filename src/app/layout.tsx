import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { cookies, headers } from "next/headers";
import { Suspense } from "react";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { AppFooter } from "@/components/app-footer";
import { AppNav } from "@/components/app-nav";
import { OverscrollReveal } from "@/components/overscroll";
import { navLinksFor, navLinksWithoutActiveMembership } from "@/components/nav-links";
import { RoleSwitcher } from "@/components/role-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { buttonClass } from "@/components/ui/button";
import { Mark } from "@/components/ui/icons";
import { pickActiveMembership } from "@/modules/identity/active-role";
import { listMembershipStates, listMemberships } from "@/modules/identity/service";
import { toSwitcherMembership } from "@/modules/identity/views";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });

export const metadata: Metadata = {
  title: "AgroHub",
  description: "Farmer cooperatives selling together.",
};

async function SwitcherSlot() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const memberships = await listMemberships(session.user.id);
  if (memberships.length < 2) return null;
  const cookieStore = await cookies();
  const active = pickActiveMembership(
    memberships,
    cookieStore.get("activeMembershipId")?.value,
  );
  if (!active) return null;
  return (
    <RoleSwitcher
      activeId={active.id}
      memberships={memberships.map(toSwitcherMembership)}
    />
  );
}

async function AccountSlot() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) return <SignOutButton />;
  const t = await getTranslations("header");
  return (
    <Link href="/sign-in" className={buttonClass("ink")}>
      {t("signIn")}
    </Link>
  );
}

// Links for the active role only; with no ACTIVE membership, the way in (register a
// cooperative, or the farm page while approval is pending). Pages still check access themselves.
async function NavSlot() {
  const t = await getTranslations("nav");
  const extras = (
    <>
      <Suspense fallback={null}>
        <SwitcherSlot />
      </Suspense>
      <Suspense fallback={null}>
        <AccountSlot />
      </Suspense>
    </>
  );
  const session = await auth.api.getSession({ headers: await headers() });
  let links: { href: string; label: string }[] = [];
  if (session) {
    const memberships = await listMemberships(session.user.id);
    const cookieStore = await cookies();
    const active = pickActiveMembership(
      memberships,
      cookieStore.get("activeMembershipId")?.value,
    );
    const raw = active
      ? navLinksFor(active.role)
      : navLinksWithoutActiveMembership(await listMembershipStates(session.user.id));
    links = raw.map((link) => ({ href: link.href, label: t(link.labelKey) }));
  }
  return (
    <AppNav
      links={links}
      label={t("label")}
      openLabel={t("openMenu")}
      closeLabel={t("closeMenu")}
      extras={extras}
    />
  );
}

async function FooterSlot() {
  const session = await auth.api.getSession({ headers: await headers() });
  return <AppFooter signedIn={Boolean(session)} />;
}

async function Shell({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const t = await getTranslations("nav");
  return (
    <html lang={locale} className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <a
            href="#main"
            className="sr-only z-50 rounded-full bg-ink px-4 py-2 text-paper focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
          >
            {t("skip")}
          </a>
          <OverscrollReveal>
          <div className="mx-auto w-full max-w-[1360px] p-2 md:p-4">
            <div className="flex min-h-[calc(100vh-1rem)] flex-col rounded-frame bg-paper p-2 md:min-h-[calc(100vh-2rem)] md:p-3">
              <header className="flex min-h-[52px] items-center justify-between gap-3 px-1 py-1">
                <Link
                  href="/"
                  aria-label={t("home")}
                  className="press relative z-50 flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 heading-6"
                >
                  <Mark />
                  AgroHub
                </Link>
                <Suspense fallback={null}>
                  <NavSlot />
                </Suspense>
              </header>
              <div className="mt-2 flex flex-1 flex-col">{children}</div>
              <Suspense fallback={null}>
                <FooterSlot />
              </Suspense>
            </div>
          </div>
          </OverscrollReveal>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
