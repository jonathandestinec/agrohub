import type { LiveController, TopicSpec } from "./controller";

// The topics one tab is watching and who is listening to each. One topic can have several
// listeners (the bell and a page both watch `alerts`); the controller sees it once. Pure: the
// controller is made by the caller, so this is tested without a browser.

export type Listener = (version: string, data: unknown, baseline: boolean, sentAt: number) => void;

export type RegistryHooks = {
  onChange(key: string, version: string, data?: unknown, baseline?: boolean, sentAt?: number): void;
  // key is a topic key, or "all" when the session is gone.
  onStop(key: string, reason: "unauthenticated" | "forbidden" | "not_found"): void;
};

export type Registry = {
  subscribe(spec: TopicSpec, listener: Listener): () => void;
  setRefresh(fn: () => void): void;
  visibilityChanged(): void;
  onlineChanged(): void;
  dispose(): void;
};

type Entry = { listeners: Set<Listener>; off: () => void; lastVersion: string | undefined };

export function createTopicRegistry(makeController: (hooks: RegistryHooks) => LiveController, now: () => number = Date.now): Registry {
  const topics = new Map<string, Entry>();
  let controller: LiveController | null = null;
  let refreshPage: () => void = () => {};

  // Made on the first subscription, which only ever happens in the browser (inside an effect).
  function get(): LiveController {
    controller ??= makeController({
      onChange: (key, version, data, baseline, sentAt) => {
        const entry = topics.get(key);
        if (!entry) return;
        entry.lastVersion = version;
        entry.listeners.forEach((listener) => listener(version, data, baseline === true, sentAt ?? now()));
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
        entry = { listeners: new Set(), off: get().subscribe(spec), lastVersion: spec.initialVersion };
        topics.set(spec.key, entry);
      } else if (entry.lastVersion !== undefined && spec.initialVersion !== undefined && entry.lastVersion !== spec.initialVersion) {
        // The topic is already running (the bell started it) and has answered with a version newer
        // than the one this page rendered from: a change happened between the render and now.
        const seen = entry.lastVersion;
        queueMicrotask(() => {
          if (topics.get(spec.key)?.listeners.has(listener)) listener(seen, undefined, false, now());
        });
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
