import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Suspense } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { auth } from "@/lib/auth";
import { RoleSwitcher } from "@/components/role-switcher";
import { pickActiveMembership } from "@/modules/identity/active-role";
import { listMemberships } from "@/modules/identity/service";
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
      memberships={memberships.map((m) => ({
        id: m.id,
        role: m.role,
        cooperativeId: m.cooperativeId,
      }))}
    />
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
            <Suspense fallback={null}>
              <SwitcherSlot />
            </Suspense>
          </header>
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
