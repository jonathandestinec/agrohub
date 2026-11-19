import { describe, expect, it } from "vitest";
import { resolveE2eDatabaseUrl } from "../e2e/base-url";

describe("resolveE2eDatabaseUrl", () => {
  it("defaults to the local agrohub_test database", () => {
    expect(resolveE2eDatabaseUrl({})).toBe("postgresql://agrohub:agrohub@localhost:5432/agrohub_test");
  });

  it("ignores DATABASE_URL, which may point at staging", () => {
    expect(resolveE2eDatabaseUrl({ DATABASE_URL: "postgresql://u:p@ep-x.neon.tech/db" })).toContain("localhost:5432/agrohub_test");
  });

  it("accepts E2E_DATABASE_URL on localhost or 127.0.0.1", () => {
    const a = "postgresql://agrohub:agrohub@localhost:5432/agrohub_e2e_a";
    const b = "postgresql://agrohub:agrohub@127.0.0.1:5432/agrohub_e2e_b";
    expect(resolveE2eDatabaseUrl({ E2E_DATABASE_URL: a })).toBe(a);
    expect(resolveE2eDatabaseUrl({ E2E_DATABASE_URL: b })).toBe(b);
  });

  it("refuses a remote host or an invalid URL", () => {
    expect(() => resolveE2eDatabaseUrl({ E2E_DATABASE_URL: "postgresql://u:p@ep-x.neon.tech/db" })).toThrow(/localhost/);
    expect(() => resolveE2eDatabaseUrl({ E2E_DATABASE_URL: "not a url" })).toThrow(/valid URL/);
  });
});
