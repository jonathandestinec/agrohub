import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Test setup: calls grantRole from scripts/grant-role.ts, the function behind
// `npm run admin:grant`. It runs under tsx in a child process because the script (and the
// Prisma client it loads) is ESM, which Playwright's CommonJS test loader cannot require.
// tsx evaluates --eval as CommonJS, so there is no top-level await.
const SCRIPT = `(async () => {
  const { grantRole } = await import("./scripts/grant-role.ts");
  const { prisma } = await import("./src/lib/db.ts");
  try { await grantRole({ email: process.env.E2E_GRANT_EMAIL, role: "ADMIN" }); }
  finally { await prisma.$disconnect(); }
})().catch((error) => { console.error(error.code ?? error.message); process.exitCode = 1; });`;

export async function grantAdmin(email: string): Promise<void> {
  const cli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  await run(process.execPath, [cli, "--eval", SCRIPT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      // Same values as the webServer env in playwright.config.ts.
      DATABASE_URL: "postgresql://agrohub:agrohub@localhost:5432/agrohub_test",
      BETTER_AUTH_SECRET: "test-only-secret-not-for-real-use-0123456789",
      BETTER_AUTH_URL: "http://localhost:3100",
      CRON_SECRET: "test-only-cron-secret",
      APP_ENV: "local",
      E2E_GRANT_EMAIL: email,
    },
  });
}
