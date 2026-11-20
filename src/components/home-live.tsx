"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useRef } from "react";
import { useLiveTopic } from "@/lib/live/live-provider";
import { shouldRefreshOnFocus } from "@/lib/live/focus";

// On a role home page: the tiles are fetched again when the tab comes back into view (at most once
// a minute) and when the person gets a new alert, which most tile changes raise. It has no timer of
// its own; the alerts topic is the same one the bell already polls. Renders nothing.
// `initialVersion` is the alerts version read before the page loaded its tiles, so an alert that
// arrives between the render and the first poll still refreshes the page.
export function HomeLive({ minGapMs = 60_000, initialVersion }: { minGapMs?: number; initialVersion?: string }) {
  const router = useRouter();
  const lastRefreshAt = useRef(0);
  useEffect(() => {
    lastRefreshAt.current = Date.now(); // the page was just rendered
  }, []);

  const refresh = useCallback(() => {
    lastRefreshAt.current = Date.now();
    startTransition(() => router.refresh());
  }, [router]);

  useLiveTopic({ key: "alerts", intervalMs: 30_000, initialVersion }, (_version, _data, baseline) => {
    if (!baseline) refresh();
  });

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && shouldRefreshOnFocus(lastRefreshAt.current, Date.now(), minGapMs)) {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh, minGapMs]);

  return null;
}
