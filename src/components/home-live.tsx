"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef } from "react";
import { useLiveTopic } from "@/lib/live/live-provider";
import { createRefreshGate, type RefreshGate } from "@/lib/live/refresh-gate";

// On a role home page: the tiles are fetched again when the tab comes back into view and when the
// person gets a new alert (which most tile changes raise), but never more than once per `minGapMs`:
// a change inside the gap is refreshed once at the end of it. It has no timer of its own for
// polling; the alerts topic is the one the bell already polls. Renders nothing.
// `initialVersion` is the alerts version read before the page loaded its tiles, so an alert that
// arrives between the render and the first poll still refreshes the page.
export function HomeLive({ minGapMs = 60_000, initialVersion }: { minGapMs?: number; initialVersion?: string }) {
  const router = useRouter();
  const gate = useRef<RefreshGate | null>(null);

  useEffect(() => {
    const created = createRefreshGate({
      minGapMs,
      now: () => Date.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (id) => window.clearTimeout(id as number),
      isVisible: () => document.visibilityState === "visible",
      refresh: () => startTransition(() => router.refresh()),
    });
    gate.current = created;
    const onVisible = () => {
      if (document.visibilityState === "visible") created.requestFocus();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      created.dispose();
      gate.current = null;
    };
  }, [router, minGapMs]);

  useLiveTopic({ key: "alerts", intervalMs: 30_000, initialVersion }, (_version, _data, baseline) => {
    if (!baseline) gate.current?.requestChange();
  });

  return null;
}
