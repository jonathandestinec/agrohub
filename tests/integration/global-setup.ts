import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { TestProject } from "vitest/node";

// Vitest 5 crashes while source-mapping the stack of an error thrown from a
// globalSetup file, which hides the message. A plain stack keeps it readable.
function fail(message: string): never {
  const error = new Error(message);
  error.stack = `Error: ${message}`;
  throw error;
}

// Applies every migration to the test database before integration tests run.
// The URL comes from vitest's test.env and is passed to Prisma explicitly, so
// nothing else (a shell variable, an .env file) can redirect it.
export default function setup(project: TestProject): void {
  const databaseUrl = project.config.env.DATABASE_URL;
  if (typeof databaseUrl !== "string") {
    fail("test.env.DATABASE_URL is not set in vitest.config.mts");
  }
  const url = new URL(databaseUrl);
  if (url.hostname !== "localhost" || !url.pathname.endsWith("_test")) {
    fail("Integration tests only run against a local *_test database");
  }

  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  try {
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    fail(
      "prisma migrate deploy failed for the test database (is Docker Postgres up? `npm run db:up`)\n" +
        `${stdout ?? ""}${stderr ?? ""}`,
    );
  }
}
