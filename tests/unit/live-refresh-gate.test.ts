import { describe, expect, it } from "vitest";
import { createRefreshGate } from "@/lib/live/refresh-gate";

// A manual clock: timers fire only when the test advances time.
function harness(options: { minGapMs?: number; startedAt?: number; visible?: boolean } = {}) {
  let time = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const state = { visible: options.visible ?? true };
  const refreshes: number[] = [];
  const gate = createRefreshGate({
    minGapMs: options.minGapMs ?? 60_000,
    startedAt: options.startedAt,
    now: () => time,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: time + ms, fn });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
    isVisible: () => state.visible,
    refresh: () => refreshes.push(time),
  });
  function advance(ms: number) {
    const end = time + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      time = Math.max(time, due[1].at);
      timers.delete(due[0]);
      due[1].fn();
    }
    time = end;
  }
  return { gate, state, refreshes, timers, advance, now: () => time };
}

describe("createRefreshGate, an alert change", () => {
  it("refreshes at once when the minimum gap has passed", () => {
    const h = harness({ startedAt: 1_000_000 - 60_000 });
    h.gate.requestChange();
    expect(h.refreshes).toHaveLength(1);
  });

  it("a burst of 5 changes in 10 seconds gives exactly one refresh now and one at the end of the gap", () => {
    const h = harness({ startedAt: 1_000_000 - 60_000 });
    const start = h.now();
    for (let i = 0; i < 5; i += 1) {
      h.gate.requestChange();
      h.advance(2_000);
    }
    expect(h.refreshes).toEqual([start]); // the first change refreshed at once
    h.advance(49_999);
    expect(h.refreshes).toHaveLength(1); // 59 999 ms after the first refresh
    h.advance(1);
    expect(h.refreshes).toEqual([start, start + 60_000]); // exactly one trailing refresh
    h.advance(600_000);
    expect(h.refreshes).toHaveLength(2);
  });

  it("a change right after the page rendered waits for the gap and is not dropped", () => {
    const h = harness(); // startedAt is now
    h.gate.requestChange();
    expect(h.refreshes).toHaveLength(0);
    h.advance(59_999);
    expect(h.refreshes).toHaveLength(0);
    h.advance(1);
    expect(h.refreshes).toHaveLength(1);
  });

  it("does not refresh a hidden tab; the focus refresh covers it on return", () => {
    const h = harness();
    h.gate.requestChange();
    h.state.visible = false;
    h.advance(60_000);
    expect(h.refreshes).toHaveLength(0);
    h.state.visible = true;
    h.gate.requestFocus();
    expect(h.refreshes).toHaveLength(1);
  });

  it("dispose cancels a waiting refresh", () => {
    const h = harness();
    h.gate.requestChange();
    h.gate.dispose();
    h.advance(120_000);
    expect(h.refreshes).toHaveLength(0);
  });
});

describe("createRefreshGate, coming back to the tab", () => {
  it("refreshes when the last refresh was at least the minimum gap ago", () => {
    const h = harness();
    h.advance(60_000);
    h.gate.requestFocus();
    expect(h.refreshes).toHaveLength(1);
  });

  it("does not refresh again within the gap, however often the tab is focused, and does not queue one", () => {
    const h = harness();
    h.advance(59_999);
    h.gate.requestFocus();
    h.gate.requestFocus();
    expect(h.refreshes).toHaveLength(0);
    h.advance(120_000);
    expect(h.refreshes).toHaveLength(0);
  });

  it("a focus refresh and a waiting change refresh count as one: the waiting one is cancelled", () => {
    const h = harness();
    h.gate.requestChange(); // waits for the end of the gap
    h.advance(60_000); // the waiting refresh fires
    expect(h.refreshes).toHaveLength(1);
    h.gate.requestChange(); // inside the new gap: waits again
    h.advance(60_000);
    h.gate.requestFocus(); // the waiting one fired at +60 s; focus now is inside a fresh gap
    expect(h.refreshes).toHaveLength(2);
  });
});
