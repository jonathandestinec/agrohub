import { describe, expect, it, vi } from "vitest";
import type { LiveController, TopicSpec } from "@/lib/live/controller";
import { createTopicRegistry, type RegistryHooks } from "@/lib/live/registry";

function harness() {
  let hooks: RegistryHooks | null = null;
  const subscribed: TopicSpec[] = [];
  const off = vi.fn();
  let made = 0;
  const controller: LiveController = {
    subscribe: (spec) => {
      subscribed.push(spec);
      return off;
    },
    visibilityChanged: vi.fn(),
    onlineChanged: vi.fn(),
    kick: vi.fn(),
    dispose: vi.fn(),
  };
  const refresh = vi.fn();
  const registry = createTopicRegistry((h) => {
    made += 1;
    hooks = h;
    return controller;
  });
  registry.setRefresh(refresh);
  const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));
  return { registry, subscribed, off, refresh, flush, made: () => made, hooks: () => hooks as RegistryHooks };
}

const spec = (key: string, initialVersion?: string): TopicSpec => ({ key, intervalMs: 1000, initialVersion });

describe("createTopicRegistry", () => {
  it("makes the controller on the first subscription and one topic per key", () => {
    const h = harness();
    expect(h.made()).toBe(0);
    h.registry.subscribe(spec("alerts"), vi.fn());
    h.registry.subscribe(spec("alerts", "9"), vi.fn());
    h.registry.subscribe(spec("thread:t1", "1"), vi.fn());
    expect(h.made()).toBe(1);
    expect(h.subscribed.map((s) => s.key)).toEqual(["alerts", "thread:t1"]);
  });

  it("hands a change to every listener of the topic, with the baseline flag and send time", () => {
    const h = harness();
    const a = vi.fn();
    const b = vi.fn();
    h.registry.subscribe(spec("alerts"), a);
    h.registry.subscribe(spec("alerts"), b);
    h.hooks().onChange("alerts", "2", { unread: 1 }, true, 123);
    expect(a).toHaveBeenCalledWith("2", { unread: 1 }, true, 123);
    expect(b).toHaveBeenCalledWith("2", { unread: 1 }, true, 123);
  });

  it("tells a page that joins a topic the bell already watches when the page rendered from an older version", async () => {
    const h = harness();
    h.registry.subscribe(spec("alerts"), vi.fn()); // the bell, from the layout
    h.hooks().onChange("alerts", "5", undefined, false, 1); // the bell's poll saw a newer version
    const page = vi.fn();
    h.registry.subscribe(spec("alerts", "4"), page); // the page rendered from version 4
    await h.flush();
    expect(page).toHaveBeenCalledTimes(1);
    expect(page.mock.calls[0].slice(0, 3)).toEqual(["5", undefined, false]);
  });

  it("does not tell a page that rendered from the current version, or when the topic has not answered yet", async () => {
    const h = harness();
    h.registry.subscribe(spec("alerts"), vi.fn());
    const early = vi.fn();
    h.registry.subscribe(spec("alerts", "4"), early); // no answer yet: the first answer is judged later
    h.hooks().onChange("alerts", "4", undefined, true, 1);
    const current = vi.fn();
    h.registry.subscribe(spec("alerts", "4"), current);
    await h.flush();
    expect(current).not.toHaveBeenCalled();
    // `early` heard the baseline answer (the page decides whether it is a change)
    expect(early).toHaveBeenCalledTimes(1);
  });

  it("does not tell a listener that left before the microtask ran", async () => {
    const h = harness();
    h.registry.subscribe(spec("alerts"), vi.fn());
    h.hooks().onChange("alerts", "5", undefined, false, 1);
    const page = vi.fn();
    const leave = h.registry.subscribe(spec("alerts", "4"), page);
    leave();
    await h.flush();
    expect(page).not.toHaveBeenCalled();
  });

  it("stops the topic when its last listener leaves", () => {
    const h = harness();
    const one = h.registry.subscribe(spec("alerts"), vi.fn());
    const two = h.registry.subscribe(spec("alerts"), vi.fn());
    one();
    expect(h.off).not.toHaveBeenCalled();
    two();
    expect(h.off).toHaveBeenCalledTimes(1);
  });

  it("drops a stopped topic and refreshes the page once", () => {
    const h = harness();
    h.registry.subscribe(spec("thread:t1", "1"), vi.fn());
    h.hooks().onStop("thread:t1", "not_found");
    expect(h.refresh).toHaveBeenCalledTimes(1);
    // A later change for it reaches nobody.
    expect(() => h.hooks().onChange("thread:t1", "2")).not.toThrow();
  });
});
