import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeOutbox } from "@/lib/email";

afterEach(() => {
  fakeOutbox.clear();
  vi.doUnmock("@/lib/env");
  vi.doUnmock("next/server");
  vi.resetModules();
});

describe("GET /api/dev/outbox", () => {
  it("returns the fake outbox when APP_ENV is local", async () => {
    fakeOutbox.sent.push({ to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" });
    // connection() needs a Next request scope; outside one it would throw.
    vi.resetModules();
    vi.doMock("next/server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("next/server")>()),
      connection: async () => {},
    }));
    const { GET } = await import("@/app/api/dev/outbox/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual([
      { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" },
    ]);
  });

  it.each(["staging", "production"] as const)(
    "returns 404 when APP_ENV is %s",
    async (appEnv) => {
      fakeOutbox.sent.push({ to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" });
      vi.resetModules();
      vi.doMock("@/lib/env", async (importOriginal) => {
        const actual = await importOriginal<typeof import("@/lib/env")>();
        return { ...actual, env: { ...actual.env, APP_ENV: appEnv } };
      });
      const { GET } = await import("@/app/api/dev/outbox/route");
      const response = await GET();

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("a@example.com");
    },
  );
});
