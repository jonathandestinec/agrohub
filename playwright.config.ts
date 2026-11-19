import { defineConfig } from "@playwright/test";
import { E2E_DATABASE_URL, E2E_ORIGIN, E2E_PORT } from "./tests/e2e/base-url";

// Port 3100 by default (CI), not 3000: a developer's own `npm run dev` on :3000 is never touched.
// Set E2E_PORT and DATABASE_URL to run another worktree's e2e at the same time (docs/environments.md).
// The default database is agrohub_test, which integration tests also clean, so never run both at once.
export default defineConfig({
  testDir: "tests/e2e",
  // next dev compiles each page on its first visit, which can take several seconds on CI.
  expect: { timeout: 15_000 },
  // On CI, also write the HTML report that the e2e job uploads when a test fails.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: E2E_ORIGIN },
  webServer: {
    command: `npx next dev -p ${E2E_PORT}`,
    url: E2E_ORIGIN,
    // Always start our own server with test env: a reused or .env-backed dev server could reach a non-local DB.
    reuseExistingServer: false,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      BETTER_AUTH_SECRET: "test-only-secret-not-for-real-use-0123456789",
      BETTER_AUTH_URL: E2E_ORIGIN,
      CRON_SECRET: "test-only-cron-secret",
      APP_ENV: "local",
    },
  },
});
