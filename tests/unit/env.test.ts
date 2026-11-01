import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const validRaw = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "a-long-enough-secret-value",
  BETTER_AUTH_URL: "http://localhost:3000",
  CRON_SECRET: "cron-secret",
};

describe("parseEnv", () => {
  it("throws an error naming the missing variables", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("defaults APP_ENV to local", () => {
    expect(parseEnv(validRaw).APP_ENV).toBe("local");
  });

  it("rejects an unknown APP_ENV", () => {
    expect(() => parseEnv({ ...validRaw, APP_ENV: "prod" })).toThrow(/APP_ENV/);
  });

  it("treats RESEND_API_KEY as optional", () => {
    expect(parseEnv(validRaw).RESEND_API_KEY).toBeUndefined();
  });

  describe("BETTER_AUTH_URL on Vercel", () => {
    const withoutAuthUrl: Record<string, string | undefined> = {
      ...validRaw,
      BETTER_AUTH_URL: undefined,
    };

    it("falls back to the Vercel branch URL when unset", () => {
      const parsed = parseEnv({
        ...withoutAuthUrl,
        VERCEL_BRANCH_URL: "agrohub-git-x.vercel.app",
        VERCEL_URL: "agrohub-abc123.vercel.app",
      });
      expect(parsed.BETTER_AUTH_URL).toBe("https://agrohub-git-x.vercel.app");
    });

    it("falls back to the Vercel deployment URL when there is no branch URL", () => {
      const parsed = parseEnv({ ...withoutAuthUrl, VERCEL_URL: "agrohub-abc123.vercel.app" });
      expect(parsed.BETTER_AUTH_URL).toBe("https://agrohub-abc123.vercel.app");
    });

    it("prefers an explicit BETTER_AUTH_URL", () => {
      const parsed = parseEnv({ ...validRaw, VERCEL_URL: "agrohub-abc123.vercel.app" });
      expect(parsed.BETTER_AUTH_URL).toBe("http://localhost:3000");
    });

    it("still requires BETTER_AUTH_URL off Vercel", () => {
      expect(() => parseEnv(withoutAuthUrl)).toThrow(/BETTER_AUTH_URL/);
    });
  });
});
