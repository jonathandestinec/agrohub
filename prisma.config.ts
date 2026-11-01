import { defineConfig } from "prisma/config";

// Prisma 7 does not load .env files, and neither does this config. DATABASE_URL
// must be set explicitly in the environment; without it every Prisma command
// targets the local Docker dev database, never a hosted one.
const LOCAL_DEV_DATABASE_URL =
  "postgresql://agrohub:agrohub@localhost:5432/agrohub";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? LOCAL_DEV_DATABASE_URL },
});
