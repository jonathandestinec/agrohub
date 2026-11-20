"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { isBaselineForListener } from "./baseline";
import { createLiveController, type TopicSpec } from "./controller";
import { createTopicRegistry, type Listener, type Registry } from "./registry";

// The browser half of live updates: one controller per tab, fed by the real clock, the Page
// Visibility API, the network state and fetch. All the timing rules live in controller.ts, which
// has unit tests; this file only connects them to the browser (covered by the e2e tests).

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

function isSlowConnection(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType ?? "");
}

// The registry (registry.ts, unit-tested) decides who hears what; this makes its controller from
// the browser: the real clock, fetch, Page Visibility and the network state.
function createBrowserRegistry(): Registry {
  return createTopicRegistry((hooks) =>
    createLiveController({
      send: async (requested, signal) => {
        const response = await fetch("/api/live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topics: requested }),
          cache: "no-store",
          signal,
        });
        if (response.status !== 200) return { status: response.status };
        const body = (await response.json()) as { topics: Record<string, never> };
        return { status: 200, topics: body.topics };
      },
      now: () => Date.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (id) => window.clearTimeout(id as number),
      isVisible: () => document.visibilityState === "visible",
      isOnline: () => navigator.onLine,
      slow: isSlowConnection,
      random: Math.random,
      onChange: hooks.onChange,
      onStop: hooks.onStop,
    }),
  );
}

const LiveContext = createContext<Registry | null>(null);

// Mounted once in the root layout, so one loop serves the whole tab however the person moves.
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [registry] = useState(createBrowserRegistry);
  // The registry is made once; it is told how to refresh the page with the current router.
  useEffect(() => {
    registry.setRefresh(() => router.refresh());
  }, [registry, router]);

  useEffect(() => {
    const visibility = () => registry.visibilityChanged();
    const online = () => registry.onlineChanged();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", visibility);
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", visibility);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
      registry.dispose();
    };
  }, [registry]);

  return <LiveContext.Provider value={registry}>{children}</LiveContext.Provider>;
}

// Watches one topic while the calling component is mounted. `onChange` runs when the topic's
// version moves on (or, for the first answer of a topic with no initialVersion, as the baseline).
export function useLiveTopic(spec: TopicSpec, onChange: Listener): void {
  const registry = useContext(LiveContext);
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  });
  const { key, intervalMs, initialVersion, minGapMs } = spec;
  const steps = spec.backoffSteps?.join(",");
  useEffect(() => {
    return registry?.subscribe(
      { key, intervalMs, initialVersion, minGapMs, backoffSteps: steps ? steps.split(",").map(Number) : undefined },
      (version, data, baseline, sentAt) =>
        handler.current(version, data, isBaselineForListener(baseline, version, initialVersion), sentAt),
    );
  }, [registry, key, intervalMs, initialVersion, minGapMs, steps]);
}
