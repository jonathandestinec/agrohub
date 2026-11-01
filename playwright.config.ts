import { defineConfig } from "@playwright/test";

// Port 3100, not 3000: a developer's own `npm run dev` on :3000 is never touched.
// The e2e run uses agrohub_test, which integration tests also clean, so never run both at once.
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100",
    // Always start our own server with test env: a reused or .env-backed dev server could reach a non-local DB.
    reuseExistingServer: false,
    env: {
      DATABASE_URL: "postgresql://agrohub:agrohub@localhost:5432/agrohub_test",
      BETTER_AUTH_SECRET: "test-only-secret-not-for-real-use-0123456789",
      BETTER_AUTH_URL: "http://localhost:3100",
      CRON_SECRET: "test-only-cron-secret",
      APP_ENV: "local",
    },
  },
});
