import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/[job]/route";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { defineJob, resetJobsForTests } from "@/lib/jobs/registry";
import { runOnce } from "@/lib/jobs/run-once";

const prefix = `test-${randomUUID()}:`;

afterEach(async () => {
  await prisma.jobRun.deleteMany({ where: { key: { startsWith: prefix } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("runOnce", () => {
  it("run_once_skips_second_call", async () => {
    const fn = vi.fn(async () => {});
    const key = `${prefix}sequential`;
    expect(await runOnce(key, fn)).toBe("ran");
    expect(await runOnce(key, fn)).toBe("skipped");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs fn once for two concurrent calls", async () => {
    const fn = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const key = `${prefix}concurrent`;
    const results = await Promise.all([runOnce(key, fn), runOnce(key, fn)]);
    expect([...results].sort()).toEqual(["ran", "skipped"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rejects when fn fails and lets a retry run again", async () => {
    const key = `${prefix}retry`;
    await expect(
      runOnce(key, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const fn = vi.fn(async () => {});
    expect(await runOnce(key, fn)).toBe("ran");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("cron route", () => {
  const jobName = `${prefix}job`;
  const call = (name: string, authorization?: string) =>
    GET(
      new Request(`http://localhost:3000/api/cron/${name}`, {
        headers: authorization ? { authorization } : {},
      }),
      { params: Promise.resolve({ job: name }) },
    );

  beforeEach(() => {
    resetJobsForTests();
  });

  it("returns 401 without the header", async () => {
    expect((await call(jobName)).status).toBe(401);
  });

  it("returns 401 with a wrong secret", async () => {
    expect((await call(jobName, "Bearer wrong")).status).toBe(401);
    expect((await call(jobName, `Bearer ${env.CRON_SECRET}x`)).status).toBe(401);
  });

  it("returns 404 for an unknown job", async () => {
    expect((await call(jobName, `Bearer ${env.CRON_SECRET}`)).status).toBe(404);
  });

  it("runs a registered job and returns 200 ran", async () => {
    const handler = vi.fn(async () => {});
    defineJob(jobName, handler);
    const res = await call(jobName, `Bearer ${env.CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "ran" });
    expect(handler).toHaveBeenCalledTimes(1);
    await prisma.jobRun.deleteMany({ where: { key: { startsWith: jobName } } });
  });

  it("returns 500 without leaking details when the handler throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      defineJob(jobName, async () => {
        throw new Error("secret-detail");
      });
      const res = await call(jobName, `Bearer ${env.CRON_SECRET}`);
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("secret-detail");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(errorSpy.mock.calls[0]);
      expect(logged).toContain(jobName);
      expect(logged).not.toContain(env.CRON_SECRET);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
