// The timing and state machine behind live updates. It owns no browser API: the clock, timers,
// visibility, network state and the request itself are injected, so tests drive it with a manual
// clock. The React wrapper (live-provider.tsx) supplies the real ones.

export type TimerId = unknown;

export type TopicResult = { version: string; data?: unknown } | { error: "forbidden" | "not_found" };

// `status` is the HTTP status; `topics` is present on 200.
export type LiveResponse = { status: number; topics?: Record<string, TopicResult> };

export type TopicRequest = { key: string; since?: string };

export type LiveDeps = {
  send(topics: TopicRequest[], signal: AbortSignal): Promise<LiveResponse>;
  now(): number;
  setTimer(fn: () => void, ms: number): TimerId;
  clearTimer(id: TimerId): void;
  isVisible(): boolean;
  isOnline(): boolean;
  // True on a slow or data-saving connection: every interval is doubled.
  slow(): boolean;
  random(): number;
  onChange(key: string, version: string, data?: unknown): void;
  // key is a topic key, or "all" when the session is gone.
  onStop(key: string, reason: "unauthenticated" | "forbidden" | "not_found"): void;
};

export type TopicSpec = {
  key: string;
  intervalMs: number;
  // The version the page was rendered from. Without it the first answer becomes the baseline.
  initialVersion?: string;
  // Fewest ms between two polls caused by coming back to the tab.
  minGapMs?: number;
  // Interval multipliers applied after every 6 unchanged polls, e.g. [1, 2, 3] for 5, 10, 15 s.
  backoffSteps?: number[];
  // Page-specific change handling is wired by the caller through onChange; nothing is stored here.
};

export type LiveController = {
  subscribe(spec: TopicSpec): () => void;
  visibilityChanged(): void;
  onlineChanged(): void;
  kick(): void;
  dispose(): void;
};

const DEFAULT_MIN_GAP_MS = 10_000;
const MAX_BACKOFF_MS = 300_000;
const UNCHANGED_PER_STEP = 6;

type Topic = {
  spec: TopicSpec;
  lastVersion: string | undefined;
  lastRunAt: number;
  nextDue: number;
  unchanged: number;
};

export function createLiveController(deps: LiveDeps): LiveController {
  const topics = new Map<string, Topic>();
  let timer: TimerId | null = null;
  let inFlight: AbortController | null = null;
  let failures = 0;
  let stopped = false;

  const canRun = () => !stopped && deps.isVisible() && deps.isOnline();

  function interval(t: Topic): number {
    const steps = t.spec.backoffSteps;
    const step = steps ? steps[Math.min(Math.floor(t.unchanged / UNCHANGED_PER_STEP), steps.length - 1)] : 1;
    return t.spec.intervalMs * step * (deps.slow() ? 2 : 1);
  }

  function clearTimer() {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }

  function abortInFlight() {
    inFlight?.abort();
    inFlight = null;
  }

  function schedule() {
    clearTimer();
    if (!canRun() || inFlight || topics.size === 0) return;
    const earliest = Math.min(...[...topics.values()].map((t) => t.nextDue));
    timer = deps.setTimer(() => {
      timer = null;
      void tick();
    }, Math.max(0, earliest - deps.now()));
  }

  async function tick() {
    if (!canRun() || inFlight) return;
    const now = deps.now();
    const due = [...topics.values()].filter((t) => t.nextDue <= now);
    if (due.length === 0) {
      schedule();
      return;
    }
    const controller = new AbortController();
    inFlight = controller;
    for (const t of due) t.lastRunAt = now;
    let response: LiveResponse | null = null;
    let failed = false;
    try {
      response = await deps.send(
        due.map((t) => ({ key: t.spec.key, since: t.lastVersion })),
        controller.signal,
      );
    } catch {
      if (controller.signal.aborted) {
        // Hidden or disposed while waiting: not a failure, and the next return to the tab polls.
        if (inFlight === controller) inFlight = null;
        if (inFlight === null) {
          // The aborted poll never answered, so it must not count towards the minimum gap.
          for (const t of due) {
            t.lastRunAt = Number.NEGATIVE_INFINITY;
            t.nextDue = deps.now();
          }
        }
        schedule();
        return;
      }
      failed = true;
    }
    if (inFlight !== controller) return; // aborted and replaced meanwhile
    inFlight = null;

    if (!failed && response && response.status === 401) {
      stopped = true;
      clearTimer();
      deps.onStop("all", "unauthenticated");
      return;
    }
    if (failed || !response || response.status !== 200 || !response.topics) {
      failures += 1;
      for (const t of due) {
        const delay = Math.min(MAX_BACKOFF_MS, interval(t) * 2 ** failures);
        t.nextDue = deps.now() + Math.round(delay * (0.8 + 0.4 * deps.random()));
      }
      schedule();
      return;
    }

    failures = 0;
    for (const t of due) {
      const result = response.topics[t.spec.key];
      if (!result) {
        t.nextDue = deps.now() + interval(t);
        continue;
      }
      if ("error" in result) {
        topics.delete(t.spec.key);
        deps.onStop(t.spec.key, result.error);
        continue;
      }
      if (t.lastVersion === undefined) {
        t.lastVersion = result.version;
        if (result.data !== undefined) deps.onChange(t.spec.key, result.version, result.data);
        t.unchanged += 1;
      } else if (result.version !== t.lastVersion) {
        t.lastVersion = result.version;
        t.unchanged = 0;
        deps.onChange(t.spec.key, result.version, result.data);
      } else {
        t.unchanged += 1;
      }
      t.nextDue = deps.now() + interval(t);
    }
    schedule();
  }

  // Back on screen or back online: topics whose last poll is older than their minimum gap poll
  // now, all in one request; the rest keep their schedule. Back-off steps start again.
  function catchUp() {
    const now = deps.now();
    for (const t of topics.values()) {
      t.unchanged = 0;
      if (now - t.lastRunAt >= (t.spec.minGapMs ?? DEFAULT_MIN_GAP_MS)) t.nextDue = now;
      else t.nextDue = Math.max(t.nextDue, t.lastRunAt + (t.spec.minGapMs ?? DEFAULT_MIN_GAP_MS));
    }
    schedule();
  }

  return {
    subscribe(spec) {
      const now = deps.now();
      topics.set(spec.key, {
        spec,
        lastVersion: spec.initialVersion,
        lastRunAt: now,
        nextDue: spec.initialVersion === undefined ? now : now + spec.intervalMs * (deps.slow() ? 2 : 1),
        unchanged: 0,
      });
      schedule();
      return () => {
        topics.delete(spec.key);
        if (topics.size === 0) {
          clearTimer();
          abortInFlight();
        }
      };
    },
    visibilityChanged() {
      if (!deps.isVisible()) {
        clearTimer();
        abortInFlight();
        return;
      }
      catchUp();
    },
    onlineChanged() {
      if (!deps.isOnline()) {
        clearTimer();
        abortInFlight();
        return;
      }
      catchUp();
    },
    kick() {
      const now = deps.now();
      for (const t of topics.values()) {
        t.unchanged = 0;
        t.nextDue = now;
      }
      schedule();
    },
    dispose() {
      stopped = true;
      clearTimer();
      abortInFlight();
      topics.clear();
    },
  };
}
