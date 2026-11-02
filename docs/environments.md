# AgroHub: Environments

Three environments. Secrets live only in environment variables, validated at startup by `src/lib/env.ts`. The variable names and placeholders are in `.env.example`. See architecture.md section 9.

| | Local | Staging | Production |
| --- | --- | --- | --- |
| `APP_ENV` | `local` | `staging` | `production` |
| Database | Docker Postgres 17 (`npm run db:up`) | A Neon branch of the staging project (`<neon-staging-branch>`) | A separate Neon project (`<neon-production-project>`) |
| Vercel environment | none (`npm run dev`) | Preview/staging project (`<vercel-staging-project>`) | Production environment (`<vercel-production-project>`) |
| Paystack keys | Fake Paystack (`PAYSTACK_SECRET_KEY` empty) or a test key | `PAYSTACK_SECRET_KEY` = a test key (`sk_test_`) only | `PAYSTACK_SECRET_KEY` = a live key, production only |
| Email | Fake outbox (`RESEND_API_KEY` empty) | Resend | Resend |
| Private storage | Fake in-memory store (`STORAGE_*` empty), served at `/api/dev-storage` | R2 bucket `<storage-staging-bucket>`, private, no public access | A separate R2 bucket `<storage-production-bucket>`, private, no public access |
| Data | Seed/dev data | Seeded demo data | Real data, backups with a tested restore |

Required variables in every environment: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CRON_SECRET`, `APP_ENV`. `APP_ENV` defaults to `local` only outside production: when `NODE_ENV` is `production` (`next build`, `next start`, Vercel) and `APP_ENV` is unset, `src/lib/env.ts` refuses to start. `RESEND_API_KEY` is required wherever real email is sent. `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID` and `STORAGE_SECRET_ACCESS_KEY` (placeholders only here) are required in staging and production; without them storage calls fail with `STORAGE_NOT_CONFIGURED`. `STORAGE_REGION` defaults to `auto`. Staging and production use separate buckets or at least separate keys, and neither bucket may allow public access: objects are opened only through signed links. Staging must never hold a live Paystack key. The Paystack secret key's variable is named exactly `PAYSTACK_SECRET_KEY`: `src/lib/env.ts` refuses to start when staging's key does not start with `sk_test_` or production's does. On Vercel, set `PAYSTACK_SECRET_KEY` (a variable named `PAYSTACK_TEST_SECRET_KEY` is not read by the app). Without it, staging and production fail at the first Paystack call (bank list, account check) with an error naming `PAYSTACK_SECRET_KEY`. On Vercel, `BETTER_AUTH_URL` may be left unset: `src/lib/env.ts` then uses `https://$VERCEL_BRANCH_URL` (or `$VERCEL_URL`), since each preview has its own URL. Set it explicitly for production's custom domain. Staging's `DATABASE_URL` is the pooled URL of the Neon `staging` branch in project `agrohub`. Run `prisma migrate deploy` against its direct (non-pooled) URL.

## Health check

`GET /api/health` returns `{ "status": "ok", "env": "<APP_ENV>", "db": "up" | "down" }`, HTTP 200 when the database answers and 503 otherwise. After a staging deploy it should return `env: "staging"` and `db: "up"`.

## CI

`.github/workflows/ci.yml` runs on every push and pull request. It needs no repository secrets. Money logic must pass before any deploy.

- `check`: Postgres 17 service container, `prisma migrate deploy` on `agrohub_test`, lint, typecheck, tests.
- `e2e`: the same Postgres service and migrations, then `npx playwright install --with-deps chromium` and `npx playwright test`, which starts `next dev` on :3100 with the env from `playwright.config.ts` (the job sets the same values inline). On failure it uploads the Playwright report and `test-results/` as the `playwright-report` artifact.

## Staging and production setup

Use placeholders like these in docs and tickets; real values live only in Vercel and the provider dashboards.

### Private storage (Backblaze B2)

Any S3-compatible store works (`src/lib/storage.ts` uses path-style requests). Staging uses Backblaze B2.

1. In Backblaze, create two buckets: `<storage-staging-bucket>` and `<storage-production-bucket>`. Never share one bucket between environments.
2. Set both to Private. Objects are opened only through the short-lived signed links the app makes.
3. Create one application key per bucket, restricted to that bucket, with Read and Write access. Note its `keyID` and `applicationKey`; the key is shown once.
4. The endpoint is on the bucket's card, for example `https://s3.us-west-004.backblazeb2.com`. Set `STORAGE_REGION` to its region part (`us-west-004`); B2 rejects the `auto` default.

For Cloudflare R2 instead, the endpoint is `https://<cloudflare-account-id>.r2.cloudflarestorage.com` and `STORAGE_REGION` stays unset (`auto`).

### Email sender

`EMAIL_FROM` is the sender for real email, for example `AgroHub <noreply@<your-domain>>`. Resend refuses any sender whose domain is not verified in the Resend account (Domains, then add the DNS records it lists). Until a domain is verified, staging and production cannot send email, so sign-up verification links never arrive. Unset, it defaults to the placeholder `AgroHub <noreply@agrohub.example>`, which Resend rejects.

### Variables per environment

| Variable | Local | Staging (Vercel Preview) | Production (Vercel Production) |
| --- | --- | --- | --- |
| `STORAGE_ENDPOINT` | empty (fake store) | `https://s3.<b2-region>.backblazeb2.com` | same endpoint |
| `STORAGE_BUCKET` | empty | `<storage-staging-bucket>` | `<storage-production-bucket>` |
| `STORAGE_ACCESS_KEY_ID` | empty | `<staging-b2-key-id>` | `<production-b2-key-id>` |
| `STORAGE_SECRET_ACCESS_KEY` | empty | `<staging-b2-application-key>` | `<production-b2-application-key>` |
| `STORAGE_REGION` | unset (`auto`) | `<b2-region>` | `<b2-region>` |
| `EMAIL_FROM` | unset (fake outbox) | `AgroHub <noreply@<verified-domain>>` | same |
| `PAYSTACK_SECRET_KEY` | empty (fake Paystack) | `sk_test_<...>` (a test key only) | `sk_live_<...>` |

- Mark the secrets as Sensitive in Vercel and scope each to its one environment.
- The Paystack variable's exact name is `PAYSTACK_SECRET_KEY`. The Vercel project already has `PAYSTACK_TEST_*` variables from earlier setup: the app never reads them, so they can be removed once `PAYSTACK_SECRET_KEY` is set.
- After changing variables, redeploy: Vercel applies them only to new deployments.

### Migrations

Run migrations from a developer machine before deploying code that needs them, against the direct (non-pooled) Neon URL, set inline so nothing else picks the database:

```sh
DATABASE_URL=<staging-direct-database-url> npx prisma migrate deploy
DATABASE_URL=<production-direct-database-url> npx prisma migrate deploy
```

Start each command with a space under `HISTCONTROL=ignorespace` to keep the URL out of shell history. Never `prisma db push` or `prisma migrate dev` against staging or production.

### First admin on staging

Sign up on the staging preview with the admin's own email and verify it, then run the `admin:grant` procedure below with the staging direct URL. On first opening an admin page they are sent to `/two-factor` to enrol.

## Seed data

```sh
npm run db:seed                                                # local Docker database
APP_ENV=staging DATABASE_URL=<staging-direct-database-url> npm run db:seed -- --allow-remote   # staging
```

- It creates an admin `seed-admin@example.com` (two-factor off, so `/two-factor` enrolment is shown), a VERIFIED cooperative `Seed Demo Farmers Cooperative` with an ACTIVE officer `seed-officer@example.com`, and a PENDING farmer `seed-farmer@example.com` with a profile. Users are created through Better Auth, so they sign in normally.
- The new users' password is printed once, when they are created. Re-running adds nothing and changes no password; to get a new one, delete the seed users first.
- Without `DATABASE_URL` it uses the local Docker database, like `prisma.config.ts`. tsx does not read `.env`.
- It refuses to run when `APP_ENV` is `production`, and when the database host is not `localhost`, `127.0.0.1` or `::1` unless both `--allow-remote` is passed and `APP_ENV=staging` is exported in the shell. It also refuses a `DATABASE_URL` with a `host` query parameter (libpq would connect there instead of the host checked). It prints only the target host and database name, never credentials.
- It writes rows only: it runs its app modules with `APP_ENV=local`, so no email, Paystack or storage call leaves the machine. The seeded cooperative has no documents or bank account.
- Never seed production. On staging, the admin's password is printed in your terminal: treat the seed admin as a demo account and enrol its two-factor straight away.

## Granting an admin role

Admins and board admins are granted from the command line, after the person has signed up and verified their email:

```sh
DATABASE_URL=<database-url> npm run admin:grant -- <email> <ADMIN|BOARD_ADMIN>
```

- `DATABASE_URL` must be set inline every time, locally too. The script runs under tsx, and neither tsx nor Prisma reads `.env`, so nothing else chooses the database. For staging or production, use that environment's direct (non-pooled) Neon URL, and keep it out of shell history (for example, start the command with a space under `HISTCONTROL=ignorespace`).
- The script needs no other variable: it fills the unused `BETTER_AUTH_*` and `CRON_SECRET` with placeholders so `src/lib/env.ts` validates.
- It creates an ACTIVE membership and writes a `membership.grant` audit row. An unknown email, an unknown role, a missing `DATABASE_URL`, or a role the user already holds exits with code 1 and changes nothing.
- The first time a page needs the new role, the admin is sent to `/two-factor` to set up an authenticator app.

## Scheduled jobs

`vercel.json` lists the cron jobs; each calls `GET /api/cron/<job>` with `Authorization: Bearer $CRON_SECRET`.

- `bank-change-apply`, daily at 05:00 UTC (`0 5 * * *`; Vercel Hobby allows only daily crons): copies confirmed bank account changes whose 48-hour wait has passed onto the cooperative. Payout code reads the effective account through `effectiveRecipientCode`, so a change counts at its effective time even before the job runs.

## Local development pages

- With `PAYSTACK_SECRET_KEY` empty and `APP_ENV=local`, Paystack calls use an in-memory fake (`fakePaystack` in `src/lib/paystack.ts`) with five banks and no accounts; an account check fails with `BANK_ACCOUNT_NOT_FOUND` until a test adds one. Bank change confirmation links appear in the fake outbox.
- `GET /api/dev/outbox` returns the fake outbox (emails "sent" locally) as JSON. It answers only when `APP_ENV=local` and returns 404 everywhere else. The e2e tests read verification links from it.
- `POST /api/dev/paystack/accounts` with JSON `{ "bankCode", "accountNumber", "accountName" }` adds an account to the running server's fake Paystack (201; 400 for a bad body). Same guards as the outbox: 404 unless `APP_ENV=local` and `NODE_ENV` is not `production`. The e2e journey uses it so bank account checks resolve.
- `npx playwright test` starts its own `next dev` on port 3100 against `agrohub_test`, so a dev server on :3000 is never touched. Integration tests clean that same database, so never run the two at the same time.

## Operational notes

- Next loads `.env`. Before `npm run dev` or `npm run build`, create `.env.local` with a local `DATABASE_URL`, or set the variables inline, so a real database URL is never picked up by accident.
- Run the Better Auth CLI only through `npm run auth:generate`.
- Production connects as a non-owner database role with only INSERT and SELECT on `audit_log`. A table owner can disable the immutability trigger.
- Never use `prisma db push`. Migrations contain raw SQL (triggers, constraints) that it would skip; use `prisma migrate deploy`.
- npm may block Prisma's install scripts. If the client is missing, run `npm run db:generate`.
