import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { cookies, headers } from "next/headers";
import { Suspense } from "react";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { AppFooter } from "@/components/app-footer";
import { AppNav, type AppNavItem } from "@/components/app-nav";
import { OverscrollReveal } from "@/components/overscroll";
import { showRoleSwitcher } from "@/components/nav-current";
import {
  navItemsFor,
  navItemsSignedOut,
  navLinksWithoutActiveMembership,
  type NavItem,
} from "@/components/nav-links";
import { RoleSwitcher } from "@/components/role-switcher";
import { AccountMenu } from "@/components/account-menu";
import { AlertBell } from "@/components/alert-bell";
import { getActor } from "@/modules/identity/session";
import { countOwnUnread, latestOwnAlerts } from "@/modules/notifications/service";
import { buttonClass } from "@/components/ui/button";
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
  if (!showRoleSwitcher(memberships.length)) return null;
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

// The bell's first paint: the unread count and the five newest alerts for the role in use. Signed
// out, or without a working identity yet (an admin before two-factor), there is no bell. After
// the first paint the bell asks /api/alerts/summary itself.
async function AlertSlot() {
  let actor;
  try {
    actor = await getActor();
  } catch {
    return null;
  }
  if (!actor) return null;
  const [unread, alerts] = await Promise.all([countOwnUnread(actor), latestOwnAlerts(actor)]);
  return <AlertBell initial={{ unread, alerts }} />;
}

async function AccountSlot() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    const memberships = await listMemberships(session.user.id);
    const cookieStore = await cookies();
    const active = pickActiveMembership(
      memberships,
      cookieStore.get("activeMembershipId")?.value,
    );
    const roles = await getTranslations("roles");
    return (
      <AccountMenu
        name={session.user.name}
        roleLabel={active ? roles(active.role) : null}
      />
    );
  }
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
  const session = await auth.api.getSession({ headers: await headers() });
  let rawItems: NavItem[] = navItemsSignedOut();
  let hasSwitcher = false;
  // The bell shows for whoever has a working role (see AlertSlot); the phone menu mirrors it.
  let hasAlerts = false;
  if (session) {
    try {
      hasAlerts = Boolean(await getActor());
    } catch {
      hasAlerts = false;
    }
    const memberships = await listMemberships(session.user.id);
    const cookieStore = await cookies();
    const active = pickActiveMembership(
      memberships,
      cookieStore.get("activeMembershipId")?.value,
    );
    rawItems = active
      ? navItemsFor(active.role)
      : navLinksWithoutActiveMembership(await listMembershipStates(session.user.id)).map(
          (link): NavItem => ({ kind: "link", ...link }),
        );
    hasSwitcher = showRoleSwitcher(memberships.length);
  }
  const items: AppNavItem[] = rawItems.map((item) =>
    item.kind === "link"
      ? { kind: "link", href: item.href, label: t(item.labelKey) }
      : {
          kind: "group",
          label: t(item.labelKey),
          links: item.links.map((link) => ({ href: link.href, label: t(link.labelKey) })),
        },
  );
  return (
    <AppNav
      items={items}
      label={t("label")}
      homeLabel={t("home")}
      openLabel={t("openMenu")}
      closeLabel={t("closeMenu")}
      hasSwitcher={hasSwitcher}
      signedIn={Boolean(session)}
      hasAlerts={hasAlerts}
      switcher={
        <Suspense fallback={null}>
          <SwitcherSlot />
        </Suspense>
      }
      bell={
        <Suspense fallback={null}>
          <AlertSlot />
        </Suspense>
      }
      account={
        <Suspense fallback={null}>
          <AccountSlot />
        </Suspense>
      }
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
              <Suspense fallback={<div className="h-[52px]" />}>
                <NavSlot />
              </Suspense>
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
