// One place for the e2e server's port and database. Defaults are what CI uses (3100,
// agrohub_test). Set E2E_PORT and E2E_DATABASE_URL to run another worktree's e2e at the same
// time, e.g. `E2E_PORT=3200 E2E_DATABASE_URL=... npx playwright test`.
const DEFAULT_DATABASE_URL = "postgresql://agrohub:agrohub@localhost:5432/agrohub_test";

// E2E runs wipe and seed their database, so it is never taken from DATABASE_URL (a shell may
// have that exported for staging) and must be on this machine.
export function resolveE2eDatabaseUrl(env: Record<string, string | undefined>): string {
  const url = env.E2E_DATABASE_URL;
  if (!url) return DEFAULT_DATABASE_URL;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("E2E_DATABASE_URL is not a valid URL.");
  }
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`E2E_DATABASE_URL must point at localhost or 127.0.0.1, not "${host}": e2e runs wipe their database.`);
  }
  return url;
}

export const E2E_PORT = process.env.E2E_PORT ?? "3100";
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;
export const E2E_DATABASE_URL = resolveE2eDatabaseUrl(process.env);
/** Matches the e2e origin's home page, with or without a trailing slash. */
export const HOME = new RegExp(`^http://localhost:${E2E_PORT}/?$`);
