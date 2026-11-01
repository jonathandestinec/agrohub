import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // Always start our own server with test env: a reused or .env-backed dev server could reach a non-local DB.
    reuseExistingServer: false,
    env: {
      DATABASE_URL: "postgresql://agrohub:agrohub@localhost:5432/agrohub_test",
      BETTER_AUTH_SECRET: "test-only-secret-not-for-real-use-0123456789",
      BETTER_AUTH_URL: "http://localhost:3000",
      CRON_SECRET: "test-only-cron-secret",
      APP_ENV: "local",
    },
  },
});
