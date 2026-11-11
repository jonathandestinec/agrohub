"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { markAllAlertsReadAction } from "@/app/alerts/actions";
import { AlertList } from "@/components/alert-list";
import { Menu, MENU_ITEM } from "@/components/ui/menu";
import type { AlertSummary } from "@/modules/notifications/views";

const BUTTON =
  "press relative flex size-11 shrink-0 items-center justify-center rounded-full bg-step hover:bg-[#e4e8df] aria-expanded:ring-2 aria-expanded:ring-lime aria-expanded:ring-offset-2 aria-expanded:ring-offset-paper";

function BellIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 caption-4 text-paper"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

// The bell in the header. Its first paint comes from the layout (`initial`); after that it asks
// /api/alerts/summary itself whenever the page changes or the list opens, because the root layout
// does not render again when someone follows a link inside the app. Below the lg breakpoint it is
// a plain link to /alerts; from lg up it opens the ten newest alerts.
export function AlertBell({ initial }: { initial: AlertSummary }) {
  const t = useTranslations("alerts");
  const pathname = usePathname();
  const [summary, setSummary] = useState(initial);
  const [seen, setSeen] = useState(initial);
  // The layout rendered again (an action revalidated it) and sent a fresh summary: take it.
  if (initial !== seen) {
    setSeen(initial);
    setSummary(initial);
  }

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/alerts/summary", { cache: "no-store" });
      // Signed out, or a network error: keep what is shown.
      if (response.ok) setSummary((await response.json()) as AlertSummary);
    } catch {
      // keep what is shown
    }
  }, []);

  const mounted = useRef(false);
  useEffect(() => {
    // The first run is the mount, and `initial` is fresh.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    void refresh();
  }, [pathname, refresh]);

  const label = t("bell", { count: summary.unread });

  async function markAll() {
    const result = await markAllAlertsReadAction();
    if (result.ok) setSummary(result.data);
  }

  return (
    <>
      <div className="hidden lg:block">
        <Menu
          align="end"
          hideChevron
          buttonLabel={label}
          buttonClassName={BUTTON}
          button={
            <>
              <BellIcon />
              <Badge count={summary.unread} />
            </>
          }
          onOpen={() => void refresh()}
        >
          <div className="flex max-h-[28rem] w-80 max-w-[80vw] flex-col gap-1 overflow-y-auto">
            {summary.alerts.length === 0 ? (
              <p className="px-3 py-2 body-6 text-ink-soft">{t("empty")}</p>
            ) : (
              <AlertList alerts={summary.alerts} />
            )}
          </div>
          <hr className="mx-2 my-1 border-ink/10" />
          <button type="button" onClick={() => void markAll()} className={MENU_ITEM}>
            {t("markAll")}
          </button>
          <Link href="/alerts" className={MENU_ITEM}>
            {t("seeAll")}
          </Link>
        </Menu>
      </div>
      <Link href="/alerts" aria-label={label} className={`${BUTTON} lg:hidden`}>
        <BellIcon />
        <Badge count={summary.unread} />
      </Link>
    </>
  );
}
