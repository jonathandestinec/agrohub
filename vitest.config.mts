import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Non-secret values so importing src/lib/env.ts (which validates eagerly) works in tests.
    env: {
      // A separate local database; tests/integration/global-setup.ts migrates it.
      DATABASE_URL: "postgresql://agrohub:agrohub@localhost:5432/agrohub_test",
      BETTER_AUTH_SECRET: "test-only-secret-not-for-real-use-0123456789",
      BETTER_AUTH_URL: "http://localhost:3000",
      CRON_SECRET: "test-only-cron-secret",
      APP_ENV: "local",
    },
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          // Migrates the test database; vitest runs it only when an integration file is selected.
          globalSetup: ["tests/integration/global-setup.ts"],
          // Integration files share one database and clean its tables, so run them one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
