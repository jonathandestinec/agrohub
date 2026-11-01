# AgroHub: Environments

Three environments. Secrets live only in environment variables, validated at startup by `src/lib/env.ts`. The variable names and placeholders are in `.env.example`. See architecture.md section 9.

| | Local | Staging | Production |
| --- | --- | --- | --- |
| `APP_ENV` | `local` | `staging` | `production` |
| Database | Docker Postgres 17 (`npm run db:up`) | A Neon branch of the staging project (`<neon-staging-branch>`) | A separate Neon project (`<neon-production-project>`) |
| Vercel environment | none (`npm run dev`) | Preview/staging project (`<vercel-staging-project>`) | Production environment (`<vercel-production-project>`) |
| Paystack keys | Test keys | Test keys only | Live keys, production only |
| Email | Fake outbox (`RESEND_API_KEY` empty) | Resend | Resend |
| Data | Seed/dev data | Seeded demo data | Real data, backups with a tested restore |

Required variables in every environment: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CRON_SECRET`, `APP_ENV`. `RESEND_API_KEY` is required wherever real email is sent. Staging must never hold a live Paystack key.

## Health check

`GET /api/health` returns `{ "status": "ok", "env": "<APP_ENV>", "db": "up" | "down" }`, HTTP 200 when the database answers and 503 otherwise. After a staging deploy it should return `env: "staging"` and `db: "up"`.

## CI

`.github/workflows/ci.yml` runs on every push and pull request: Postgres 17 service container, `prisma migrate deploy` on `agrohub_test`, lint, typecheck, tests. It needs no repository secrets. Money logic must pass before any deploy.

## Operational notes

- Next loads `.env`. Before `npm run dev` or `npm run build`, create `.env.local` with a local `DATABASE_URL`, or set the variables inline, so a real database URL is never picked up by accident.
- Run the Better Auth CLI only through `npm run auth:generate`.
- Production connects as a non-owner database role with only INSERT and SELECT on `audit_log`. A table owner can disable the immutability trigger.
- Never use `prisma db push`. Migrations contain raw SQL (triggers, constraints) that it would skip; use `prisma migrate deploy`.
- npm may block Prisma's install scripts. If the client is missing, run `npm run db:generate`.
