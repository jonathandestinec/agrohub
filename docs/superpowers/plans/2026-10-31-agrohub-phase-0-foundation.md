# AgroHub Phase 0: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Next.js app with authentication, memberships and role switching, admin two-factor enforcement, policy checks, audit log, money utilities, email, i18n scaffolding, a job runner and CI, so every later phase builds on tested foundations.

**Architecture:** One Next.js app; infrastructure in `src/lib/*`, domain logic in `src/modules/*`. Roles are our own `Membership` table; Better Auth handles login, verification, sessions and two-factor. See `docs/architecture.md`.

**Tech Stack:** Next.js (App Router), TypeScript, Tailwind, Prisma, Postgres (Docker locally, Neon hosted), Better Auth, Resend, next-intl, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-31-agrohub-design.md` (sections 3, 4, 8, 9, 10). Roadmap: `2026-10-31-agrohub-roadmap.md`.

## Global Constraints

- Money is integer kobo; percentages are integer basis points. No floats.
- Admin and board admin sessions require two-factor authentication.
- A farmer has exactly one cooperative; an officer belongs to one cooperative.
- An officer cannot approve their own lots; another officer does, or an admin when there is none.
- English is the default locale; other locales are enabled only after native-speaker review.
- Separate staging and production environments with separate keys; staging uses Paystack test keys only.
- Secrets only in environment variables, validated at startup.

## Review Focus

Each line below has its test inside the task named.

1. Splitting money never loses or invents a kobo (Task 2, `split_always_sums_to_total`).
2. An officer approving their own lot, in a one-person cooperative, is refused and routed to an admin (Task 5, `officer_cannot_approve_own_lot`, `admin_may_approve_when_no_other_officer`).
3. The audit log cannot be edited or deleted, even by raw SQL (Task 7, `audit_rows_are_immutable`).
4. A scheduled job fired twice runs once (Task 10, `run_once_skips_second_call`).
5. An unreviewed language is never served (Task 8, `resolve_locale_falls_back_to_english`).

---

### Task 1: Scaffold and tooling

**Files:**
- Create: project via `create-next-app` (TypeScript, Tailwind, App Router, ESLint, `src/` directory), `vitest.config.ts`, `playwright.config.ts`, `docker-compose.yml`, `.env.example`, `src/lib/env.ts`, `tests/unit/env.test.ts`
- Modify: `package.json` scripts: `test`, `typecheck`, `lint`, `db:up`, `db:migrate`

**Interfaces:**
- Produces: `parseEnv(raw: Record<string, string | undefined>): Env` and `env: Env` from `src/lib/env.ts`, where `Env = { DATABASE_URL: string; BETTER_AUTH_SECRET: string; BETTER_AUTH_URL: string; CRON_SECRET: string; APP_ENV: 'local' | 'staging' | 'production'; RESEND_API_KEY?: string }`.

- [ ] **Step 1: Write the failing test** in `tests/unit/env.test.ts`: `parseEnv({})` throws an error whose message names `DATABASE_URL`; `parseEnv(validRaw)` returns `APP_ENV === 'local'` when `APP_ENV` is absent; `parseEnv({ ...validRaw, APP_ENV: 'prod' })` throws.
- [ ] **Step 2: Run** `npm test -- tests/unit/env.test.ts`. Expected: FAIL, `parseEnv` not defined.
- [ ] **Step 3: Implement** `parseEnv` in `src/lib/env.ts` with a zod schema; `docker-compose.yml` runs Postgres on port 5432 with a named volume; `.env.example` lists every variable with no real values.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`. Expected: all pass; `npm run db:up` starts Postgres.
- [ ] **Step 5: Commit** `git add -A && git commit -m "chore: scaffold app, tooling and env validation"`

### Task 2: Money utilities

**Files:**
- Create: `src/lib/money.ts`, `tests/unit/money.test.ts`

**Interfaces:**
- Produces: `toKobo(naira: string): number`, `formatNaira(kobo: number): string`, `applyBps(kobo: number, bps: number): number` (rounds down), `splitByWeights(totalKobo: number, weights: number[]): number[]` (largest-remainder, sums exactly).

- [ ] **Step 1: Write the failing tests:** `toKobo('1500.50') === 150050`; `toKobo('1500.505')` throws; `formatNaira(150050) === '₦1,500.50'`; `applyBps(100000, 1000) === 10000`; `applyBps(999, 1000) === 99`; `splitByWeights(1000, [1, 1, 1])` equals `[334, 333, 333]`; `splitByWeights(100, [3, 0, 1])` equals `[75, 0, 25]`; `splitByWeights(100, [0, 0])` throws; property test `split_always_sums_to_total` over random totals and weights.
- [ ] **Step 2: Run** `npm test -- tests/unit/money.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the four functions; parse `toKobo` with a decimal-string regex, never `parseFloat`; give remainders to the largest fractional parts, ties to the lower index.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add money utilities`

### Task 3: Email adapter

**Files:**
- Create: `src/lib/email.ts`, `tests/unit/email.test.ts`

**Interfaces:**
- Produces: `sendEmail(msg: { to: string; subject: string; html: string }): Promise<void>`; `fakeOutbox: { sent: Array<{ to: string; subject: string; html: string }>; clear(): void }` used when `APP_ENV` is `local` or under test; Resend is used otherwise.

- [ ] **Step 1: Write the failing test:** under test, `sendEmail({ to: 'a@b.com', subject: 'Hi', html: '<p>x</p>' })` appends exactly one entry to `fakeOutbox.sent` and does not call the network.
- [ ] **Step 2: Run** `npm test -- tests/unit/email.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the transport switch: fake outbox for local/test, Resend client when `RESEND_API_KEY` is set and `APP_ENV` is not local.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add email adapter with fake outbox`

### Task 4: Database and authentication

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/db.ts`, `src/lib/auth.ts`, `src/app/api/auth/[...all]/route.ts`, `tests/integration/auth.test.ts`
- Modify: `package.json` (`db:migrate`)

**Interfaces:**
- Consumes: `env`, `sendEmail` from Tasks 1 and 3.
- Produces: `prisma: PrismaClient` from `src/lib/db.ts`; `auth` from `src/lib/auth.ts` configured with email and password, required email verification (verification email sent through `sendEmail`), and additional user fields `phone: string`, `consentAcceptedAt: Date`, `locale: string`.

- [ ] **Step 1: Write the failing test:** signing up with email, password, phone and consent creates a user and puts exactly one verification email in `fakeOutbox.sent`; signing in before verifying is refused; signing up without consent is refused.
- [ ] **Step 2: Run** `npm test -- tests/integration/auth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the Better Auth config and generate its Prisma models with Better Auth's CLI; confirm current option names in its documentation (not verified when this plan was written); mount the route handler.
- [ ] **Step 4: Run** `npm run db:migrate` then the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add database and email/password auth with verification`

### Task 5: Memberships and policies

**Files:**
- Create: `src/modules/identity/policies.ts`, `src/modules/identity/service.ts`, `tests/integration/membership.test.ts`, `tests/access/policy-matrix.test.ts`
- Modify: `prisma/schema.prisma` (add `Role` enum and `Membership`), new migration with a partial unique index

**Interfaces:**
- Produces: `type Role = 'FARMER' | 'OFFICER' | 'BUYER' | 'ADMIN' | 'BOARD_ADMIN'`; `type Actor = { userId: string; role: Role; cooperativeId: string | null }`; `type Action = 'cooperative:verify' | 'price:write' | 'farmer:approve' | 'lot:approve' | 'dispute:resolve'`; `can(actor: Actor, action: Action, resource?: { cooperativeId?: string; ownerUserId?: string; cooperativeHasOtherOfficer?: boolean }): boolean`; `addMembership(input: { userId: string; role: Role; cooperativeId?: string }): Promise<Membership>`.

- [ ] **Step 1: Write the failing tests.** Integration: a second FARMER membership for the same user fails; a duplicate `(userId, role, cooperativeId)` fails. Policy matrix (a table of every action by every role): ADMIN may `cooperative:verify` and `dispute:resolve`; only BOARD_ADMIN may `price:write`; an OFFICER may `farmer:approve` only for their own `cooperativeId`; test `officer_cannot_approve_own_lot` (officer with `ownerUserId` equal to their own id gets `false`); an OFFICER of another cooperative gets `false`; test `admin_may_approve_when_no_other_officer` (ADMIN gets `true` for `lot:approve` only when `cooperativeHasOtherOfficer === false`).
- [ ] **Step 2: Run** `npm test -- tests/integration/membership.test.ts tests/access/policy-matrix.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema (partial unique index on `userId` where `role = 'FARMER'`, written in raw SQL in the migration), `addMembership`, and `can` as a pure function with one rule per action.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add memberships and policy checks`

### Task 6: Admin two-factor enforcement

**Files:**
- Create: `src/modules/identity/second-factor.ts`, `tests/unit/second-factor.test.ts`
- Modify: `src/lib/auth.ts` (enable Better Auth's two-factor plugin)

**Interfaces:**
- Consumes: `Role`, `Actor` from Task 5.
- Produces: `requireSecondFactor(session: { role: Role; twoFactorVerified: boolean }): void` throwing `ForbiddenError('2FA_REQUIRED')` for `ADMIN` and `BOARD_ADMIN` when `twoFactorVerified` is false; no effect for other roles.

- [ ] **Step 1: Write the failing test:** table of role by `twoFactorVerified`; only `ADMIN` and `BOARD_ADMIN` without verification throw `2FA_REQUIRED`.
- [ ] **Step 2: Run** `npm test -- tests/unit/second-factor.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `requireSecondFactor` and the shared `ForbiddenError` in `src/lib/errors.ts`; enable the two-factor plugin in `auth.ts`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat: enforce 2FA for admin roles`

### Task 7: Audit log

**Files:**
- Create: `src/modules/audit/audit.ts`, `tests/integration/audit.test.ts`
- Modify: `prisma/schema.prisma` (`AuditLog`), new migration with an immutability trigger

**Interfaces:**
- Produces: `recordAudit(input: { actorId: string | null; action: string; entity: string; entityId: string; meta?: Record<string, unknown> }): Promise<void>`.

- [ ] **Step 1: Write the failing tests:** `recordAudit` inserts one row with the given fields; `audit_rows_are_immutable`: a raw `UPDATE` and a raw `DELETE` on `AuditLog` both throw.
- [ ] **Step 2: Run** `npm test -- tests/integration/audit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the model, `recordAudit`, and a Postgres trigger in the migration that raises an exception on UPDATE or DELETE.
- [ ] **Step 4: Run** `npm run db:migrate` then the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add append-only audit log`

### Task 8: Internationalization scaffolding

**Files:**
- Create: `src/i18n/config.ts`, `src/i18n/request.ts`, `messages/en.json`, `messages/pcm.json`, `messages/ha.json`, `messages/yo.json`, `messages/ig.json`, `tests/unit/i18n.test.ts`

**Interfaces:**
- Produces: `locales = ['en', 'pcm', 'ha', 'yo', 'ig'] as const`; `type Locale = (typeof locales)[number]`; `enabledLocales: Locale[]` (initially `['en']`); `resolveLocale(input: string | undefined): Locale`.

- [ ] **Step 1: Write the failing tests:** `resolve_locale_falls_back_to_english`: `resolveLocale('ha')` returns `'en'` while `enabledLocales` is `['en']`; `resolveLocale(undefined)` returns `'en'`; with `enabledLocales` set to `['en', 'ha']` in the test, `resolveLocale('ha')` returns `'ha'`; every non-English message file has exactly the keys of `en.json`.
- [ ] **Step 2: Run** `npm test -- tests/unit/i18n.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the config and next-intl request setup; the non-English files start as copies of the `en.json` keys with empty values.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add i18n scaffolding, English only`

### Task 9: App shell and role switcher

**Files:**
- Create: `src/styles/tokens.css`, `src/components/role-switcher.tsx`, `src/modules/identity/active-role.ts`, `src/app/layout.tsx` (modify), `tests/unit/active-role.test.ts`

**Interfaces:**
- Consumes: `Membership`, `Role` from Task 5.
- Produces: `pickActiveMembership(memberships: Membership[], preferredId?: string): Membership | null` (the preferred one if it exists in the list, otherwise by priority ADMIN, BOARD_ADMIN, OFFICER, FARMER, BUYER, otherwise null); server action `setActiveRole(membershipId: string): Promise<void>` that refuses a membership belonging to another user; CSS variables in `tokens.css` as the single brand slot (colors, fonts, radii).

- [ ] **Step 1: Write the failing test:** `pickActiveMembership` returns the preferred membership when present; with no preference and memberships `[BUYER, OFFICER]` returns the OFFICER; with an empty list returns `null`; a preferred id not in the list is ignored.
- [ ] **Step 2: Run** `npm test -- tests/unit/active-role.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `pickActiveMembership`, the server action (checks ownership, stores the choice in a cookie), the role-switcher component, mobile-first layout using the tokens.
- [ ] **Step 4: Run** the test, then `npm run dev` and confirm by hand that a user with two memberships can switch between them.
- [ ] **Step 5: Commit** `feat: add app shell with role switcher and brand token slot`

### Task 10: Scheduled-job runner

**Files:**
- Create: `src/lib/jobs/registry.ts`, `src/lib/jobs/run-once.ts`, `src/app/api/cron/[job]/route.ts`, `tests/integration/jobs.test.ts`
- Modify: `prisma/schema.prisma` (`JobRun { key unique, ranAt }`), `vercel.json` (cron entries, initially empty)

**Interfaces:**
- Produces: `runOnce(key: string, fn: () => Promise<void>): Promise<'ran' | 'skipped'>`; `defineJob(name: string, handler: () => Promise<void>): void`; the route rejects requests without `Authorization: Bearer ${CRON_SECRET}` with 401 and unknown job names with 404.

- [ ] **Step 1: Write the failing tests:** `run_once_skips_second_call`: calling `runOnce('k', fn)` twice returns `'ran'` then `'skipped'` and `fn` runs once; two concurrent calls run `fn` once; the route returns 401 without the secret and 404 for an unknown job.
- [ ] **Step 2: Run** `npm test -- tests/integration/jobs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `runOnce` by inserting the `JobRun` key and treating a unique-violation as `'skipped'`; implement the registry and route.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add scheduled-job runner with idempotency`

### Task 11: Health route, CI and environments

**Files:**
- Create: `src/app/api/health/route.ts`, `tests/integration/health.test.ts`, `.github/workflows/ci.yml`, `docs/environments.md`

**Interfaces:**
- Produces: `GET /api/health` returning `{ status: 'ok', env: Env['APP_ENV'], db: 'up' | 'down' }` with HTTP 200 when the database answers and 503 otherwise.

- [ ] **Step 1: Write the failing test:** the route returns 200 and `{ status: 'ok', db: 'up' }` against the test database; with the database unreachable it returns 503 and `db: 'down'`.
- [ ] **Step 2: Run** `npm test -- tests/integration/health.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the route (a `SELECT 1` through Prisma); write `ci.yml` (checkout, Node, `npm ci`, a Postgres service container, `prisma migrate deploy`, lint, typecheck, tests); write `docs/environments.md` listing local, staging and production, which Neon branch and Vercel environment each uses, and that Paystack test keys are staging only.
- [ ] **Step 4: Run** the test and push a branch. Expected: CI green. Create the Vercel project and Neon branches by hand, deploy staging, and confirm `GET <staging-url>/api/health` returns `{ "status": "ok", "env": "staging", "db": "up" }`.
- [ ] **Step 5: Commit** `chore: add health route, CI and environment docs`

---

## Self-review

- **Spec coverage:** sections 3 (roles, memberships, switcher, admin 2FA), 4 (stack, environments, i18n, brand token slot), 8 (audit log, 2FA, secrets, staging separation) and 10 (email, scheduled jobs, CI) each map to a task. Cooperative, lot, order and payment features belong to Phases 1 to 5 and are intentionally absent.
- **Type consistency:** `Role`, `Actor`, `Action` are defined in Task 5 and used unchanged in Task 6 and Task 9; `ForbiddenError` is defined once in Task 6; `fakeOutbox` from Task 3 is what Task 4 asserts on.
- **Open item:** Better Auth option names and the two-factor plugin API were not verified when this plan was written; Tasks 4 and 6 say to confirm them in its documentation.
