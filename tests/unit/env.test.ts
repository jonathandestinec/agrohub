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
});
