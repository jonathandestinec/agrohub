// How often a role home page may be refreshed. A refresh runs every tile's queries (about 110
// statements for an officer's home, measured), so it is limited to once per `minGapMs`, however many
// alerts arrive or however often the tab is focused. Pure: time, timers and visibility are injected.
export type RefreshGateDeps = {
  minGapMs: number;
  // When the page was last refreshed (default: now, because the page was just rendered).
  startedAt?: number;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  isVisible(): boolean;
  refresh(): void;
};

export type RefreshGate = {
  // A change arrived (a new alert): refresh now if the gap has passed, otherwise once at the end of
  // the gap, so the page is never left stale and a burst costs one refresh.
  requestChange(): void;
  // The tab came back into view: refresh only if the gap has passed; nothing is queued.
  requestFocus(): void;
  dispose(): void;
};

export function createRefreshGate(deps: RefreshGateDeps): RefreshGate {
  let lastRefreshAt = deps.startedAt ?? deps.now();
  let waiting: unknown = null;

  function cancelWaiting() {
    if (waiting !== null) deps.clearTimer(waiting);
    waiting = null;
  }

  function run() {
    cancelWaiting();
    lastRefreshAt = deps.now();
    deps.refresh();
  }

  return {
    requestChange() {
      const wait = lastRefreshAt + deps.minGapMs - deps.now();
      if (wait <= 0) {
        run();
        return;
      }
      if (waiting !== null) return; // one is already waiting for the end of the gap
      waiting = deps.setTimer(() => {
        waiting = null;
        // A hidden tab is refreshed when it comes back (the gap will have passed by then).
        if (deps.isVisible()) run();
      }, wait);
    },
    requestFocus() {
      if (deps.now() - lastRefreshAt >= deps.minGapMs) run();
    },
    dispose: cancelWaiting,
  };
}
