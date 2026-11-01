import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/**/*.test.ts"],
    // Non-secret values so importing src/lib/env.ts (which validates eagerly) works in tests.
    env: {
      DATABASE_URL: "postgresql://agrohub:agrohub@localhost:5432/agrohub",
      BETTER_AUTH_SECRET: "test-only-secret-not-for-real-use-0123456789",
      BETTER_AUTH_URL: "http://localhost:3000",
      CRON_SECRET: "test-only-cron-secret",
      APP_ENV: "local",
    },
  },
});
