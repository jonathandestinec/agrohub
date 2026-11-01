// Runs the Better Auth CLI from an empty temp dir so it can never load the repo's .env (real secrets).
// Never run `auth generate` with the repo root as cwd.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "agrohub-auth-"));
writeFileSync(
  join(scratch, "tsconfig.json"),
  JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": [join(root, "src", "*").replaceAll("\\", "/")] } } }),
);

// Inert placeholders so src/lib/env.ts validates; the CLI only reads the schema and never connects.
const placeholderEnv = {
  DATABASE_URL: "postgresql://placeholder:placeholder@localhost:1/placeholder",
  BETTER_AUTH_SECRET: "placeholder-secret-for-schema-generation-only",
  BETTER_AUTH_URL: "http://localhost:3000",
  CRON_SECRET: "placeholder",
  APP_ENV: "local",
  BETTER_AUTH_TELEMETRY: "0",
};

const result = spawnSync(
  process.execPath,
  [
    join(root, "node_modules", "auth", "dist", "index.mjs"),
    "generate",
    "--cwd", scratch,
    "--config", join(root, "src", "lib", "auth.ts"),
    "--output", join(root, "prisma", "schema.prisma"),
    "--yes",
  ],
  { cwd: scratch, stdio: "inherit", env: { ...process.env, ...placeholderEnv } },
);
rmSync(scratch, { recursive: true, force: true });
process.exit(result.status ?? 1);
