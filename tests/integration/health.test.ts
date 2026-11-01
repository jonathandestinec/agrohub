import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.resetModules();
});

describe("GET /api/health", () => {
  it("returns 200 and db up against the test database", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", env: "local", db: "up" });
  });

  it("returns 503 and db down when the database is unreachable", async () => {
    // Keep the real pingDatabase so its own catch is exercised; only the query rejects.
    vi.resetModules();
    vi.doMock("@/lib/db", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/db")>();
      vi.spyOn(actual.prisma, "$queryRaw").mockRejectedValue(new Error("connection refused"));
      return actual;
    });
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", env: "local", db: "down" });
  });
});
