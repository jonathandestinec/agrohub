import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Suspense } from "react";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { navLinksFor, navLinksWithoutActiveMembership } from "@/components/nav-links";
import { RoleSwitcher } from "@/components/role-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { pickActiveMembership } from "@/modules/identity/active-role";
import { listMembershipStates, listMemberships } from "@/modules/identity/service";
import { toSwitcherMembership } from "@/modules/identity/views";
import "./globals.css";

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

// Links for the active role only; with no ACTIVE membership, the way in (register a
// cooperative, or the farm page while approval is pending). Pages still check access themselves.
async function NavSlot() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const memberships = await listMemberships(session.user.id);
  const cookieStore = await cookies();
  const active = pickActiveMembership(
    memberships,
    cookieStore.get("activeMembershipId")?.value,
  );
  const links = active
    ? navLinksFor(active.role)
    : navLinksWithoutActiveMembership(await listMembershipStates(session.user.id));
  if (links.length === 0) return null;
  const t = await getTranslations("nav");
  return (
    <nav aria-label={t("label")} className="border-b border-border bg-surface px-4">
      <ul className="flex flex-wrap gap-x-4">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="flex min-h-11 items-center text-base text-primary underline"
            >
              {t(link.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

async function AccountSlot() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) return <SignOutButton />;
  const t = await getTranslations("header");
  return (
    <Link href="/sign-in" className="flex min-h-11 items-center px-2 text-base text-primary underline">
      {t("signIn")}
    </Link>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
            <span className="font-[family-name:var(--font-heading)] text-lg font-semibold text-primary">
              AgroHub
            </span>
            <div className="flex items-center gap-3">
              <Suspense fallback={null}>
                <SwitcherSlot />
              </Suspense>
              <Suspense fallback={null}>
                <AccountSlot />
              </Suspense>
            </div>
          </header>
          <Suspense fallback={null}>
            <NavSlot />
          </Suspense>
          {children}
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
