# AgroHub: Environments

Three environments. Secrets live only in environment variables, validated at startup by `src/lib/env.ts`. The variable names and placeholders are in `.env.example`. See architecture.md section 9.

| | Local | Staging | Production |
| --- | --- | --- | --- |
| `APP_ENV` | `local` | `staging` | `production` |
| Database | Docker Postgres 17 (`npm run db:up`) | A Neon branch of the staging project (`<neon-staging-branch>`) | A separate Neon project (`<neon-production-project>`) |
| Vercel environment | none (`npm run dev`) | Preview/staging project (`<vercel-staging-project>`) | Production environment (`<vercel-production-project>`) |
| Paystack keys | Test keys | Test keys only | Live keys, production only |
| Email | Fake outbox (`RESEND_API_KEY` empty) | Resend | Resend |
| Private storage | Fake in-memory store (`STORAGE_*` empty), served at `/api/dev-storage` | R2 bucket `<storage-staging-bucket>`, private, no public access | A separate R2 bucket `<storage-production-bucket>`, private, no public access |
| Data | Seed/dev data | Seeded demo data | Real data, backups with a tested restore |

Required variables in every environment: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CRON_SECRET`, `APP_ENV`. `RESEND_API_KEY` is required wherever real email is sent. `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID` and `STORAGE_SECRET_ACCESS_KEY` (placeholders only here) are required in staging and production; without them storage calls fail with `STORAGE_NOT_CONFIGURED`. `STORAGE_REGION` defaults to `auto`. Staging and production use separate buckets or at least separate keys, and neither bucket may allow public access: objects are opened only through signed links. Staging must never hold a live Paystack key. On Vercel, `BETTER_AUTH_URL` may be left unset: `src/lib/env.ts` then uses `https://$VERCEL_BRANCH_URL` (or `$VERCEL_URL`), since each preview has its own URL. Set it explicitly for production's custom domain. Staging's `DATABASE_URL` is the pooled URL of the Neon `staging` branch in project `agrohub`. Run `prisma migrate deploy` against its direct (non-pooled) URL.

## Health check

`GET /api/health` returns `{ "status": "ok", "env": "<APP_ENV>", "db": "up" | "down" }`, HTTP 200 when the database answers and 503 otherwise. After a staging deploy it should return `env: "staging"` and `db: "up"`.

## CI

`.github/workflows/ci.yml` runs on every push and pull request: Postgres 17 service container, `prisma migrate deploy` on `agrohub_test`, lint, typecheck, tests. It needs no repository secrets. Money logic must pass before any deploy.

## Granting an admin role

Admins and board admins are granted from the command line, after the person has signed up and verified their email:

```sh
DATABASE_URL=<database-url> npm run admin:grant -- <email> <ADMIN|BOARD_ADMIN>
```

- `DATABASE_URL` must be set inline every time, locally too. The script runs under tsx, and neither tsx nor Prisma reads `.env`, so nothing else chooses the database. For staging or production, use that environment's direct (non-pooled) Neon URL, and keep it out of shell history (for example, start the command with a space under `HISTCONTROL=ignorespace`).
- The script needs no other variable: it fills the unused `BETTER_AUTH_*` and `CRON_SECRET` with placeholders so `src/lib/env.ts` validates.
- It creates an ACTIVE membership and writes a `membership.grant` audit row. An unknown email, an unknown role, a missing `DATABASE_URL`, or a role the user already holds exits with code 1 and changes nothing.
- The first time a page needs the new role, the admin is sent to `/two-factor` to set up an authenticator app.

## Local development pages

- `GET /api/dev/outbox` returns the fake outbox (emails "sent" locally) as JSON. It answers only when `APP_ENV=local` and returns 404 everywhere else. The e2e tests read verification links from it.
- `npx playwright test` starts its own `next dev` on port 3100 against `agrohub_test`, so a dev server on :3000 is never touched. Integration tests clean that same database, so never run the two at the same time.

## Operational notes

- Next loads `.env`. Before `npm run dev` or `npm run build`, create `.env.local` with a local `DATABASE_URL`, or set the variables inline, so a real database URL is never picked up by accident.
- Run the Better Auth CLI only through `npm run auth:generate`.
- Production connects as a non-owner database role with only INSERT and SELECT on `audit_log`. A table owner can disable the immutability trigger.
- Never use `prisma db push`. Migrations contain raw SQL (triggers, constraints) that it would skip; use `prisma migrate deploy`.
- npm may block Prisma's install scripts. If the client is missing, run `npm run db:generate`.
