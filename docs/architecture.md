# AgroHub: Project Architecture

Spec: `docs/superpowers/specs/2026-10-31-agrohub-design.md`. This file says how the spec is built. Where it says "my call", the spec did not decide it.

## 1. Shape of the system

One Next.js app (App Router, TypeScript, Tailwind) in one repo, deployed to Vercel. One Postgres database on Neon, accessed through Prisma. No separate backend.

```
Browser (phone-first)
   |
Next.js app
   |-- app/            routes and layouts only; no business logic
   |-- src/modules/    all business logic, one folder per domain
   |-- src/lib/        shared infrastructure (db, auth, money, email, storage, paystack, jobs, i18n)
   |
Neon Postgres  |  Paystack  |  Resend  |  S3-compatible private bucket  |  Vercel Cron
```

Rule: components and route handlers call module services. Services call Prisma and integrations. Nothing else touches the database or Paystack.

## 2. Repository layout

```
agrohub/
  CLAUDE.md
  docs/                      spec, plans, this file, environments.md
  prisma/                    schema.prisma, migrations/, seed.ts
  messages/                  en.json (enabled), pcm.json, ha.json, yo.json, ig.json
  src/
    app/                     route groups: (public), (auth), farmer, officer, buyer, admin, board, api
    components/              UI only
    i18n/                    config.ts, request.ts
    lib/                     env.ts, db.ts, auth.ts, money.ts, email.ts, storage.ts, paystack.ts, jobs/
    modules/
      identity/              users, memberships, roles, policies (can), active-role
      cooperatives/          signup, documents, verification, invite links, suspension
      farmers/               profile, bank recipient, approval, leaving
      catalog/               crops, units, lots, screening, fee terms, contributions
      board/                 price points, deviation check
      marketplace/           browse/filter, offers, negotiation rules, reservations
      orders/                order state machine, delivery schedule, cancellation, shortfall
      payments/              paystack payments, ledger, payouts, refunds, reconciliation
      messaging/             threads, messages
      reviews/
      analytics/
      inputs/                input orders, signups, loans (tracking only)
      notifications/         email events
      support/               reports, disputes
      audit/                 append-only audit log
    styles/tokens.css        brand token slot (brand identity arrives later)
  tests/                     unit/, integration/, access/, e2e/
```

Each module folder holds: `service.ts` (the only public entry), `schema.ts` (zod input schemas), `views.ts` (mappers to safe public shapes), `*.test.ts`. A module imports another module only through that module's `service.ts`.

## 3. Cross-cutting rules

- **Money:** integer kobo everywhere; percentages are integer basis points (1000 = 10%). Only `src/lib/money.ts` does arithmetic and formatting. No floats.
- **Authorization:** every service function takes an `Actor` and calls `can(actor, action, resource)` from `identity/policies.ts` before touching data. Cooperative data is always scoped by `cooperativeId`.
- **Private fields never serialize:** the floor price, phone numbers and bank data leave the server only through mapper functions in `views.ts` (for example `toPublicLot`). Mapper return types omit the private fields, and tests assert the serialized JSON contains no floor value.
- **Validation:** zod at every boundary (server action input, route handler, webhook body).
- **Idempotency:** webhooks, payouts, refunds and scheduled jobs are safe to run twice (unique references and a `JobRun` key table).
- **Audit:** approvals, price changes, role changes, bank changes, admin actions and every money movement write to the append-only audit log.
- **Errors:** services throw typed errors (`ForbiddenError`, `NotFoundError`, `ConflictError`, `ValidationError`); route handlers translate them to responses.
- **i18n:** `next-intl`; all user-facing strings in `messages/*.json`. Only `en` is in `enabledLocales` until a native speaker reviews another file.

## 4. Identity and roles

- Better Auth handles email and password login, email verification, sessions and two-factor authentication. (Plugin and option names to be confirmed against its current docs in Phase 0.)
- Roles live in our own `Membership` table, not in Better Auth's organization feature (my call: keeps the one-cooperative rules and officer rules under our control).
- `Membership { id, userId, role: FARMER|OFFICER|BUYER|ADMIN|BOARD_ADMIN, cooperativeId?, status }`. A farmer has exactly one cooperative (partial unique index). An officer belongs to one cooperative. One login can hold several memberships; the role switcher sets the active one.
- Admin and board admin sessions require two-factor authentication.

## 5. Data model (entities and the fields that matter)

- **User** (Better Auth) plus `phone`, `phoneConfirmed`, `consentAcceptedAt`, `locale`.
- **Cooperative** `{ status: PENDING|VERIFIED|SUSPENDED, certificateExpiresAt, cutBps, recipientCode }`; **CooperativeDocument** `{ storageKey, kind }`; **InviteLink** `{ token, revokedAt }`.
- **FarmerProfile** `{ farmSize, crops, state, lga, recipientCode, approvedAt }`. Account numbers are never stored; only the Paystack recipient code.
- **Crop**, **Unit** (kg, bag, tonne, basket, ... maintained by board admin); **PricePoint** `{ cropId, market, weekOf, priceKobo }`.
- **Lot** `{ cooperativeId, cropId, unitId, quantity, grade, pickupLocation, askKobo, floorKobo (private), note, status, availableUntil, minOrderQty }`; **LotContribution** `{ lotId, farmerUserId, quantity }`; **LotFeeTerms** `{ lotId, cooperativeCutBps, platformFeeBps }` locked at approval.
- **Offer** `{ lotId, buyerUserId, quantity, offeredKobo, status, expiresAt }`; **StockReservation** `{ lotId, quantity, expiresAt, orderId? }`.
- **Order** `{ buyerUserId, cooperativeId, status, totalKobo, deliveryCostKobo, deliveryDate }` with **OrderLine** `{ lotId, quantity, unitPriceKobo, termsSnapshot }`.
- **Payment** `{ orderId, paystackReference unique, status }`; **PaystackEvent** `{ eventId unique, payload }`; **LedgerEntry** `{ orderId, account, amountKobo, direction }` (append-only); **Payout** `{ orderId, recipientCode, amountKobo, reference unique, status }`; **Refund**.
- **Thread**, **Message**; **Review**; **Report**; **Dispute**; **Notification**.
- **InputOrder**, **InputSignup**, **Loan** (tracking only).
- **AuditLog** (append-only), **JobRun** `{ key unique }`, **Setting** `{ key, value }` (platform fee, max cooperative cut, price-deviation threshold, timeouts).

## 6. State machines

- **Cooperative:** PENDING -> VERIFIED <-> SUSPENDED. Verification lapses at `certificateExpiresAt`.
- **Lot:** DRAFT -> PENDING_REVIEW -> (COUNTERED | REJECTED | LIVE); LIVE -> (SOLD_OUT | WITHDRAWN | EXPIRED). Editing a live lot's price or quantity creates a pending revision; the live version stays until approved.
- **Offer:** OPEN -> (ACCEPTED | REJECTED | COUNTERED | EXPIRED | WITHDRAWN). Accepted offers hold stock for 24 hours.
- **Order:** PENDING_PAYMENT -> PAID_HELD -> PREPARING -> DELIVERED_MARKED -> COMPLETED. Side exits: CANCELLED, REFUNDED, DISPUTED, TIMED_OUT. Payouts are created only on the transition to COMPLETED, by server code.

## 7. Money flow

1. `payments.service.startCheckout` reserves stock (15 minutes, row lock) and initializes a Paystack transaction for 100% of the total.
2. The webhook route verifies Paystack's signature, records the `PaystackEvent` once, verifies the transaction with Paystack, then moves the order to PAID_HELD and writes ledger entries.
3. On completion (buyer confirms, or 3 days after the officer marks delivery) the server creates one `Payout` per recipient (cooperative, each farmer) with a unique reference and sends them by Paystack transfer once funds have cleared. The platform fee stays.
4. Invariants, enforced by tests: per order, ledger entries sum to zero; payouts plus platform fee equal the amount paid minus refunds; no recipient is paid twice.
5. The payout method (transfers or Paystack manual settlement) is isolated behind `payments/payout-gateway.ts`, so it can change after Paystack answers without touching the order logic.

## 8. Integrations

| Service | Used for | Boundary |
| --- | --- | --- |
| Paystack | checkout, webhooks, refunds, transfer recipients, transfers | `src/lib/paystack.ts` (thin client), `modules/payments` |
| Resend | all email | `src/lib/email.ts` with a fake transport for tests and local |
| Private bucket (R2 or S3) | verification documents, lot photos | `src/lib/storage.ts`, signed URLs only |
| Vercel Cron | scheduled jobs | `app/api/cron/[job]/route.ts` guarded by `CRON_SECRET` |

Scheduled jobs: offer expiry, reservation release, lot expiry, auto-release, delivery timeout, certificate reminders, reconciliation, alerts. Each is wrapped in `runOnce`.

## 9. Environments

- Local: Docker Postgres, fake email transport, Paystack test keys.
- Staging: Vercel preview/staging project, Neon branch, Paystack **test** keys only, seeded demo data.
- Production: separate Vercel environment and Neon project, live keys, backups with a tested restore.
- Secrets only in environment variables, validated at startup by `src/lib/env.ts`.

## 10. Testing

- Unit and integration: Vitest, against a real Postgres (Docker locally, service container in CI). Money, policies, state machines and payouts are tested with tables of exact values.
- Access matrix: `tests/access/policy-matrix.test.ts` lists every action by every role. Each phase adds rows.
- End to end: Playwright for the critical journeys (join, list, offer, pay in test mode, deliver, payout).
- CI runs lint, typecheck and tests on every push. Money logic must pass before any deploy.

## 11. Decisions left open

Paystack's written answer on holding funds and manual settlement; the AgroHub fee percentage and maximum cooperative cut; the price-deviation threshold (starting default 20%, my call); brand identity; weather alerts (deferred).

## 12. Dependencies

- create-next-app tooling: next, react, react-dom, typescript, tailwindcss, eslint (+ eslint-config-next), @types/*; the app framework and lint/type tooling.
- zod: runtime validation of environment variables and, later, service input schemas.
- vitest: unit and integration test runner (resolves the `@/` alias natively).
- @playwright/test: end-to-end tests; browsers are installed separately when first needed.
- fast-check (dev): property-based tests, e.g. money splits always sum exactly to the total.
- resend: sends transactional email (verification and later notifications) in staging and production; local and tests use the in-memory fake outbox.
- prisma (dev) and @prisma/client: schema, migrations and the typed database client; Prisma 7 reads `prisma.config.ts` and never loads `.env`.
- @prisma/adapter-pg: the node-postgres driver adapter Prisma 7 needs to connect to Postgres (local Docker and Neon).
- better-auth: email and password login, email verification and sessions (its two-factor plugin enforces admin 2FA), stored through its Prisma adapter.
- auth (dev): the Better Auth CLI; `auth generate` writes Better Auth's models into `prisma/schema.prisma`. Run it only through `npm run auth:generate`, which uses an empty temp cwd so the CLI never loads `.env`.
- next-intl: message loading and translations for the App Router; locale comes from a `locale` cookie (no locale-prefixed routing), and only locales listed in `enabledLocales` are ever served.
