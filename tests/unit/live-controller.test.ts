import { describe, expect, it } from "vitest";
import {
  createLiveController,
  type LiveDeps,
  type LiveResponse,
  type TopicResult,
} from "@/lib/live/controller";

// A manual clock: timers only fire when the test advances time, so nothing is real.
function harness(options: { visible?: boolean; online?: boolean; slow?: boolean } = {}) {
  let time = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const state = {
    visible: options.visible ?? true,
    online: options.online ?? true,
    slow: options.slow ?? false,
  };
  const calls: { keys: { key: string; since?: string }[]; signal: AbortSignal }[] = [];
  let pending: { resolve: (r: LiveResponse) => void; reject: (e: unknown) => void } | null = null;
  let auto: ((keys: { key: string; since?: string }[]) => LiveResponse | Error) | null = null;
  const changes: { key: string; version: string; data?: unknown }[] = [];
  const stops: { key: string; reason: string }[] = [];

  const deps: LiveDeps = {
    send: (keys, signal) => {
      calls.push({ keys, signal });
      if (auto) {
        const out = auto(keys);
        return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
      }
      return new Promise<LiveResponse>((resolve, reject) => {
        pending = { resolve, reject };
      });
    },
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
    isOnline: () => state.online,
    slow: () => state.slow,
    random: () => 0.5, // jitter factor 1.0
    onChange: (key, version, data) => changes.push({ key, version, data }),
    onStop: (key, reason) => stops.push({ key, reason }),
  };

  async function flush() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
  async function advance(ms: number) {
    const end = time + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      time = Math.max(time, due[1].at);
      timers.delete(due[0]);
      due[1].fn();
      await flush();
    }
    time = end;
    await flush();
  }
  const ok = (topics: Record<string, TopicResult>): LiveResponse => ({ status: 200, topics });
  return {
    deps,
    state,
    calls,
    timers,
    changes,
    stops,
    flush,
    advance,
    ok,
    answer: async (r: LiveResponse) => {
      pending?.resolve(r);
      pending = null;
      await flush();
    },
    fail: async (e: unknown) => {
      pending?.reject(e);
      pending = null;
      await flush();
    },
    autoAnswer: (fn: (keys: { key: string; since?: string }[]) => LiveResponse | Error) => {
      auto = fn;
    },
    setTime: (t: number) => {
      time = t;
    },
  };
}

describe("createLiveController", () => {
  it("does not overlap requests", async () => {
    const h = harness();
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 1000, initialVersion: "1" });
    await h.advance(1000);
    expect(h.calls).toHaveLength(1);
    await h.advance(10_000); // still waiting for the answer
    expect(h.calls).toHaveLength(1);
    await h.answer(h.ok({ a: { version: "1" } }));
    await h.advance(1000);
    expect(h.calls).toHaveLength(2);
  });

  it("pauses when hidden and aborts the in-flight request", async () => {
    const h = harness();
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 1000, initialVersion: "1" });
    await h.advance(1000);
    expect(h.calls).toHaveLength(1);
    h.state.visible = false;
    c.visibilityChanged();
    expect(h.calls[0].signal.aborted).toBe(true);
    expect(h.timers.size).toBe(0);
    await h.advance(60_000);
    expect(h.calls).toHaveLength(1);
  });

  it("makes no request while hidden from the start", async () => {
    const h = harness({ visible: false });
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 1000, initialVersion: "1" });
    await h.advance(60_000);
    expect(h.calls).toHaveLength(0);
  });

  it("polls once on return to visible when older than minGapMs, and not when newer", async () => {
    const h = harness();
    h.autoAnswer(() => h.ok({ a: { version: "1" } }));
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 600_000, initialVersion: "1", minGapMs: 10_000 });
    h.state.visible = false;
    c.visibilityChanged();
    await h.advance(60_000);
    h.state.visible = true;
    c.visibilityChanged();
    await h.advance(0);
    expect(h.calls).toHaveLength(1); // catch-up once
    // flip again straight away: gap not elapsed, so no second request
    h.state.visible = false;
    c.visibilityChanged();
    h.state.visible = true;
    c.visibilityChanged();
    await h.advance(1000);
    expect(h.calls).toHaveLength(1);
  });

  it("does nothing while offline and does not grow the backoff", async () => {
    const h = harness({ online: false });
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 1000, initialVersion: "1" });
    await h.advance(120_000);
    expect(h.calls).toHaveLength(0);
    h.autoAnswer(() => h.ok({ a: { version: "1" } }));
    h.state.online = true;
    c.onlineChanged();
    await h.advance(0);
    expect(h.calls).toHaveLength(1);
    await h.advance(1000);
    expect(h.calls).toHaveLength(2); // normal cadence, no inflated delay
  });

  it("backs off 2x with jitter and caps at 300000 ms, then resets on success", async () => {
    const h = harness();
    h.autoAnswer(() => new Error("network"));
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 100_000, initialVersion: "1" });
    await h.advance(100_000);
    expect(h.calls).toHaveLength(1); // first failure: next delay 100000 * 2 = 200000
    await h.advance(199_999);
    expect(h.calls).toHaveLength(1);
    await h.advance(1);
    expect(h.calls).toHaveLength(2); // second failure: 100000 * 4 capped to 300000
    await h.advance(299_999);
    expect(h.calls).toHaveLength(2);
    await h.advance(1);
    expect(h.calls).toHaveLength(3);
    h.autoAnswer(() => h.ok({ a: { version: "1" } }));
    await h.advance(300_000);
    expect(h.calls).toHaveLength(4); // success resets
    await h.advance(100_000);
    expect(h.calls).toHaveLength(5);
  });

  it("applies jitter between 0.8 and 1.2", async () => {
    const h = harness();
    h.autoAnswer(() => new Error("network"));
    const lowDeps = { ...h.deps, random: () => 0 };
    const c = createLiveController(lowDeps);
    c.subscribe({ key: "a", intervalMs: 100_000, initialVersion: "1" });
    await h.advance(100_000);
    expect(h.calls).toHaveLength(1);
    await h.advance(160_000 - 1); // 200000 * 0.8
    expect(h.calls).toHaveLength(1);
    await h.advance(1);
    expect(h.calls).toHaveLength(2);
  });

  it("stops everything and reports unauthenticated on 401", async () => {
    const h = harness();
    h.autoAnswer(() => ({ status: 401 }));
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 1000, initialVersion: "1" });
    c.subscribe({ key: "b", intervalMs: 1000, initialVersion: "1" });
    await h.advance(1000);
    expect(h.stops).toEqual([{ key: "all", reason: "unauthenticated" }]);
    await h.advance(60_000);
    expect(h.calls).toHaveLength(1);
  });

  it("stops one topic on not_found or forbidden and keeps the rest", async () => {
    const h = harness();
    h.autoAnswer(() => h.ok({ a: { error: "not_found" }, b: { version: "1" } }));
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 1000, initialVersion: "1" });
    c.subscribe({ key: "b", intervalMs: 1000, initialVersion: "1" });
    await h.advance(1000);
    expect(h.stops).toEqual([{ key: "a", reason: "not_found" }]);
    await h.advance(1000);
    expect(h.calls[1].keys.map((k) => k.key)).toEqual(["b"]);
  });

  it("slows a backoff topic 5s to 10s to 15s after 6 unchanged polls each and resets on change", async () => {
    const h = harness();
    let version = "1";
    h.autoAnswer(() => h.ok({ t: { version } }));
    const c = createLiveController(h.deps);
    c.subscribe({ key: "t", intervalMs: 5000, initialVersion: "1", backoffSteps: [1, 2, 3] });
    for (let i = 0; i < 6; i++) await h.advance(5000);
    expect(h.calls).toHaveLength(6);
    await h.advance(5000);
    expect(h.calls).toHaveLength(6); // now every 10 s
    await h.advance(5000);
    expect(h.calls).toHaveLength(7);
    for (let i = 0; i < 5; i++) await h.advance(10_000);
    expect(h.calls).toHaveLength(12);
    await h.advance(10_000);
    expect(h.calls).toHaveLength(12); // now every 15 s
    await h.advance(5000);
    expect(h.calls).toHaveLength(13);
    version = "2"; // a change resets to 5 s
    await h.advance(15_000);
    expect(h.changes).toHaveLength(1);
    await h.advance(5000);
    expect(h.calls).toHaveLength(15);
  });

  it("doubles intervals when the connection is slow", async () => {
    const h = harness({ slow: true });
    h.autoAnswer(() => h.ok({ a: { version: "1" } }));
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 5000, initialVersion: "1" });
    await h.advance(5000);
    expect(h.calls).toHaveLength(0);
    await h.advance(5000);
    expect(h.calls).toHaveLength(1);
  });

  it("wakes at the earliest due topic and sends only the topics that are due", async () => {
    const h = harness();
    h.autoAnswer((keys) =>
      h.ok(Object.fromEntries(keys.map((k) => [k.key, { version: "1" }]))),
    );
    const c = createLiveController(h.deps);
    c.subscribe({ key: "fast", intervalMs: 15_000, initialVersion: "1" });
    c.subscribe({ key: "slow", intervalMs: 30_000, initialVersion: "1" });
    await h.advance(15_000);
    expect(h.calls[0].keys.map((k) => k.key)).toEqual(["fast"]);
    await h.advance(15_000);
    expect(h.calls[1].keys.map((k) => k.key).sort()).toEqual(["fast", "slow"]);
  });

  it("calls onChange only when the version differs from the last seen", async () => {
    const h = harness();
    let version = "1";
    h.autoAnswer(() => h.ok({ a: { version } }));
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 1000, initialVersion: "1" });
    await h.advance(3000);
    expect(h.changes).toHaveLength(0);
    version = "2";
    await h.advance(1000);
    expect(h.changes).toEqual([{ key: "a", version: "2", data: undefined }]);
    await h.advance(3000);
    expect(h.changes).toHaveLength(1);
  });

  it("sends the last seen version as since, and with no initialVersion the first answer is the baseline (data delivered)", async () => {
    const h = harness();
    h.autoAnswer(() => h.ok({ a: { version: "7", data: { unread: 1 } } }));
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 1000 });
    await h.advance(0);
    expect(h.calls[0].keys).toEqual([{ key: "a", since: undefined }]);
    expect(h.changes).toEqual([{ key: "a", version: "7", data: { unread: 1 } }]);
    await h.advance(1000);
    expect(h.calls[1].keys).toEqual([{ key: "a", since: "7" }]);
  });

  it("an initialVersion that matches prevents a false first change", async () => {
    const h = harness();
    h.autoAnswer(() => h.ok({ a: { version: "5" } }));
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 1000, initialVersion: "5" });
    await h.advance(1000);
    expect(h.changes).toHaveLength(0);
  });

  it("unsubscribe removes the topic and clears the timer when none are left", async () => {
    const h = harness();
    const c = createLiveController(h.deps);
    const off = c.subscribe({ key: "a", intervalMs: 1000, initialVersion: "1" });
    off();
    expect(h.timers.size).toBe(0);
    await h.advance(5000);
    expect(h.calls).toHaveLength(0);
  });

  it("dispose aborts and stops", async () => {
    const h = harness();
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 1000, initialVersion: "1" });
    await h.advance(1000);
    c.dispose();
    expect(h.calls[0].signal.aborted).toBe(true);
    await h.advance(10_000);
    expect(h.calls).toHaveLength(1);
  });

  it("kick polls everything now", async () => {
    const h = harness();
    h.autoAnswer(() => h.ok({ a: { version: "1" } }));
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 60_000, initialVersion: "1" });
    c.kick();
    await h.advance(0);
    expect(h.calls).toHaveLength(1);
  });

  it("ignores an aborted request's rejection without backing off", async () => {
    const h = harness();
    const c = createLiveController(h.deps);
    c.subscribe({ key: "a", intervalMs: 1000, initialVersion: "1" });
    await h.advance(1000);
    h.state.visible = false;
    c.visibilityChanged();
    await h.fail(new DOMException("aborted", "AbortError"));
    h.state.visible = true;
    h.autoAnswer(() => h.ok({ a: { version: "1" } }));
    c.visibilityChanged();
    await h.advance(500);
    expect(h.calls).toHaveLength(2); // polled again at once, with no inflated delay
  });
});
