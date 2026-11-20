"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { isBaselineForListener } from "./baseline";
import { createLiveController, type LiveController, type TopicSpec } from "./controller";

// The browser half of live updates: one controller per tab, fed by the real clock, the Page
// Visibility API, the network state and fetch. All the timing rules live in controller.ts, which
// has unit tests; this file only connects them to the browser (covered by the e2e tests).

type Listener = (version: string, data: unknown, baseline: boolean, sentAt: number) => void;

type Registry = {
  subscribe(spec: TopicSpec, listener: Listener): () => void;
  setRefresh(fn: () => void): void;
  visibilityChanged(): void;
  onlineChanged(): void;
  dispose(): void;
};

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

function isSlowConnection(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType ?? "");
}

function createRegistry(): Registry {
  let refreshPage: () => void = () => {};
  const topics = new Map<string, { listeners: Set<Listener>; off: () => void }>();
  let controller: LiveController | null = null;

  // Made on the first subscription, which only ever happens in the browser (inside an effect).
  function get(): LiveController {
    controller ??= createLiveController({
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
      onChange: (key, version, data, baseline, sentAt) => {
        topics.get(key)?.listeners.forEach((listener) => listener(version, data, baseline === true, sentAt ?? Date.now()));
      },
      // The session ended, or the person may no longer see this page (another tab switched role):
      // stop asking, and let the server decide what the page should now be (sign-in, 404).
      onStop: (key) => {
        if (key !== "all") topics.delete(key);
        refreshPage();
      },
    });
    return controller;
  }

  return {
    subscribe(spec, listener) {
      let entry = topics.get(spec.key);
      if (!entry) {
        entry = { listeners: new Set(), off: get().subscribe(spec) };
        topics.set(spec.key, entry);
      }
      entry.listeners.add(listener);
      return () => {
        const current = topics.get(spec.key);
        if (!current) return;
        current.listeners.delete(listener);
        if (current.listeners.size === 0) {
          current.off();
          topics.delete(spec.key);
        }
      };
    },
    setRefresh(fn) {
      refreshPage = fn;
    },
    visibilityChanged: () => controller?.visibilityChanged(),
    onlineChanged: () => controller?.onlineChanged(),
    dispose: () => controller?.dispose(),
  };
}

const LiveContext = createContext<Registry | null>(null);

// Mounted once in the root layout, so one loop serves the whole tab however the person moves.
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [registry] = useState(createRegistry);
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
