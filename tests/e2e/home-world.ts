import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Test setup for the home pages: gives a signed-up user a membership directly (the join flow is
// proved by its own specs). Runs under tsx in a child process, like lot-world.ts.
const SCRIPT = `(async () => {
  const { prisma } = await import("./src/lib/db.ts");
  const e = process.env;
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: e.E2E_USER } });
    if (e.E2E_ROLE === "BUYER") {
      await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
      await prisma.membership.create({ data: { userId: user.id, role: "BUYER", status: "ACTIVE", approvedAt: new Date() } });
    } else {
      const coop = await prisma.cooperative.findFirstOrThrow({ where: { name: e.E2E_COOP } });
      await prisma.membership.create({ data: { userId: user.id, role: "FARMER", cooperativeId: coop.id, status: "PENDING" } });
      await prisma.farmerProfile.create({ data: { userId: user.id, cooperativeId: coop.id, farmSizeHectares: "1", state: "Kaduna", lga: "Zaria" } });
    }
  } finally { await prisma.$disconnect(); }
})().catch((error) => { console.error(error.code ?? error.message); process.exitCode = 1; });`;

async function give(env: Record<string, string>): Promise<void> {
  const cli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  await run(process.execPath, [cli, "--eval", SCRIPT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ?? "postgresql://agrohub:agrohub@localhost:5432/agrohub_test",
      BETTER_AUTH_SECRET: "test-only-secret-not-for-real-use-0123456789",
      BETTER_AUTH_URL: "http://localhost:3100",
      CRON_SECRET: "test-only-cron-secret",
      APP_ENV: "local",
      ...env,
    },
  });
}

/** A PENDING farmer membership (with a profile) in the named cooperative. */
export const makePendingFarmer = (email: string, cooperative: string) =>
  give({ E2E_USER: email, E2E_ROLE: "FARMER", E2E_COOP: cooperative });

/** An ACTIVE buyer membership (email marked verified). */
export const makeBuyer = (email: string) => give({ E2E_USER: email, E2E_ROLE: "BUYER", E2E_COOP: "" });
