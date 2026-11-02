import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePaystack, resolveAccount } from "@/lib/paystack";

const ACCOUNT = { bankCode: "058", accountNumber: "0123456789", accountName: "SUNRISE FARMERS LTD" };

function post(body: unknown): Request {
  return new Request("http://localhost:3100/api/dev/paystack/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  fakePaystack.clear();
  vi.doUnmock("@/lib/env");
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("POST /api/dev/paystack/accounts", () => {
  it("registers a fake account that resolveAccount then finds", async () => {
    const { POST } = await import("@/app/api/dev/paystack/accounts/route");
    const response = await POST(post(ACCOUNT));

    expect(response.status).toBe(201);
    // The account number is never echoed back.
    expect(await response.text()).not.toContain(ACCOUNT.accountNumber);
    await expect(
      resolveAccount({ bankCode: ACCOUNT.bankCode, accountNumber: ACCOUNT.accountNumber }),
    ).resolves.toEqual({ accountName: ACCOUNT.accountName });
  });

  it.each([
    ["a malformed body", "not json"],
    ["a 9-digit account number", { ...ACCOUNT, accountNumber: "012345678" }],
    ["a non-numeric bank code", { ...ACCOUNT, bankCode: "GTB" }],
    ["an empty account name", { ...ACCOUNT, accountName: "  " }],
    ["a missing account name", { bankCode: "058", accountNumber: "0123456789" }],
  ])("returns 400 for %s and registers nothing", async (_label, body) => {
    const { POST } = await import("@/app/api/dev/paystack/accounts/route");
    const response = await POST(post(body));

    expect(response.status).toBe(400);
    expect(fakePaystack.accounts.size).toBe(0);
  });

  it.each(["staging", "production"] as const)(
    "returns 404 when APP_ENV is %s",
    async (appEnv) => {
      vi.resetModules();
      vi.doMock("@/lib/env", async (importOriginal) => {
        const actual = await importOriginal<typeof import("@/lib/env")>();
        return { ...actual, env: { ...actual.env, APP_ENV: appEnv } };
      });
      const { POST } = await import("@/app/api/dev/paystack/accounts/route");
      const response = await POST(post(ACCOUNT));

      expect(response.status).toBe(404);
      expect(fakePaystack.accounts.size).toBe(0);
    },
  );

  it("returns 404 when NODE_ENV is production, even with APP_ENV local", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { env } = await import("@/lib/env");
    expect(env.APP_ENV).toBe("local");
    const { POST } = await import("@/app/api/dev/paystack/accounts/route");
    const response = await POST(post(ACCOUNT));

    expect(response.status).toBe(404);
    expect(fakePaystack.accounts.size).toBe(0);
  });
});
