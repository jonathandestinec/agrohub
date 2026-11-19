import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("next/server");
  vi.resetModules();
});

describe("deferWork", () => {
  it("hands the task to after() and resolves without running it", async () => {
    const scheduled: Array<() => Promise<void>> = [];
    vi.resetModules();
    vi.doMock("next/server", () => ({ after: (fn: () => Promise<void>) => scheduled.push(fn) }));
    const { deferWork } = await import("@/lib/defer");
    const task = vi.fn(async () => {});
    await deferWork(task);
    expect(task).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runs the task inline and awaited when there is no request scope", async () => {
    vi.resetModules();
    vi.doMock("next/server", () => ({
      after: () => {
        throw new Error("`after` was called outside a request scope");
      },
    }));
    const { deferWork } = await import("@/lib/defer");
    let done = false;
    await deferWork(async () => {
      await new Promise((r) => setTimeout(r, 5));
      done = true;
    });
    expect(done).toBe(true);
  });

  it("never rejects when the task throws, inline or deferred", async () => {
    const scheduled: Array<() => Promise<void>> = [];
    vi.resetModules();
    vi.doMock("next/server", () => ({ after: (fn: () => Promise<void>) => scheduled.push(fn) }));
    const { deferWork } = await import("@/lib/defer");
    const boom = async () => {
      throw new Error("boom");
    };
    await expect(deferWork(boom)).resolves.toBeUndefined();
    await expect(scheduled[0]()).resolves.toBeUndefined();

    vi.resetModules();
    vi.doMock("next/server", () => ({
      after: () => {
        throw new Error("outside");
      },
    }));
    const inline = await import("@/lib/defer");
    await expect(inline.deferWork(boom)).resolves.toBeUndefined();
  });
});
