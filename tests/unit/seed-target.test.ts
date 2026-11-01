import { describe, expect, it } from "vitest";
import { checkSeedTarget } from "../../prisma/seed";

const LOCAL = "postgresql://agrohub:agrohub@localhost:5432/agrohub";
const REMOTE = "postgresql://owner:s3cret-pass@ep-example-123.eu-central-1.aws.neon.tech/agrohub?sslmode=require";

describe("checkSeedTarget", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])("allows a local database on %s", (host) => {
    const result = checkSeedTarget({
      databaseUrl: `postgresql://agrohub:agrohub@${host}:5432/agrohub`,
      appEnv: "local",
      allowRemote: false,
    });
    expect(result).toMatchObject({ ok: true, database: "agrohub" });
  });

  it("refuses APP_ENV production, even on localhost and with --allow-remote", () => {
    for (const allowRemote of [false, true]) {
      const result = checkSeedTarget({ databaseUrl: LOCAL, appEnv: "production", allowRemote });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/APP_ENV is production/);
    }
  });

  it("refuses a remote host without --allow-remote, naming host and database only", () => {
    const result = checkSeedTarget({ databaseUrl: REMOTE, appEnv: "staging", allowRemote: false });
    expect(result).toMatchObject({
      ok: false,
      host: "ep-example-123.eu-central-1.aws.neon.tech",
      database: "agrohub",
    });
    expect(result.reason).toMatch(/--allow-remote/);
    const printed = JSON.stringify(result);
    expect(printed).not.toContain("s3cret-pass");
    expect(printed).not.toContain("owner");
  });

  it("allows a remote host with --allow-remote outside production", () => {
    const result = checkSeedTarget({ databaseUrl: REMOTE, appEnv: "staging", allowRemote: true });
    expect(result.ok).toBe(true);
  });

  it("refuses a URL it cannot parse without echoing it", () => {
    const result = checkSeedTarget({
      databaseUrl: "not a url with s3cret-pass",
      appEnv: "local",
      allowRemote: false,
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("s3cret-pass");
  });
});
