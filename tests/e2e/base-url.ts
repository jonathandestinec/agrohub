// One place for the e2e server's port. Default 3100 (what CI uses); set E2E_PORT to run
// another worktree's e2e at the same time, e.g. `E2E_PORT=3200 npx playwright test`.
export const E2E_PORT = process.env.E2E_PORT ?? "3100";
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;
/** Database for the e2e server and the helpers that spawn scripts (grant.ts, lot-world.ts). */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://agrohub:agrohub@localhost:5432/agrohub_test";
/** Matches the e2e origin's home page, with or without a trailing slash. */
export const HOME = new RegExp(`^http://localhost:${E2E_PORT}/?$`);
