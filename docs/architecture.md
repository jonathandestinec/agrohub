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
      name-changes/          admin-approved changes to a person's or a verified cooperative's name
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
      notifications/         email events, and in-app alerts: `notify` (written by other services in their own transaction), the bell and /alerts reads, and `GET /api/alerts/summary` for the bell's count
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
- **Audit:** approvals, price changes, role changes, bank changes, name changes, admin actions and every money movement write to the append-only audit log.
- **Errors:** services throw typed errors (`ForbiddenError`, `NotFoundError`, `ConflictError`, `ValidationError`); route handlers translate them to responses.
- **i18n:** `next-intl`; all user-facing strings in `messages/*.json`. Only `en` is in `enabledLocales` until a native speaker reviews another file.

## 4. Identity and roles

- Better Auth handles email and password login, email verification, sessions and two-factor authentication. (Plugin and option names to be confirmed against its current docs in Phase 0.)
- Roles live in our own `Membership` table, not in Better Auth's organization feature (my call: keeps the one-cooperative rules and officer rules under our control).
- `Membership { id, userId, role: FARMER|OFFICER|BUYER|ADMIN|BOARD_ADMIN, cooperativeId?, status }`. A farmer has exactly one cooperative (partial unique index). An officer belongs to one cooperative. One login can hold several memberships; the role switcher sets the active one.
- Admin and board admin sessions require two-factor authentication.

## 5. Data model (entities and the fields that matter)

- **User** (Better Auth) plus `phone`, `phoneConfirmed`, `consentAcceptedAt`, `locale`.
- **Cooperative** `{ status: PENDING|VERIFIED|SUSPENDED, certificateExpiresAt, cutBps (default 0, at most the admin maximum), recipientCode }`; **CooperativeDocument** `{ storageKey, kind }`; **InviteLink** `{ token, revokedAt }`.
- **FarmerProfile** `{ farmSize, crops (links to Crop, chosen from the board's list), state, lga, recipientCode, approvedAt }`. Account numbers are never stored; only the Paystack recipient code.
- **Crop**, **Unit** (kg, bag, tonne, basket, ... maintained by board admin); **PricePoint** `{ cropId, unitId, market, marketKey, weekOf, priceKobo }`, one per crop, unit, market and Lagos week (Monday). Crops and units are deactivated, never deleted.
- **Lot** `{ cooperativeId, farmerUserId, cropId, unitId, quantity, grade (A|B|C|UNGRADED), pickupState, pickupLga, pickupNote, askKobo, floorKobo (private), note, deviation (OK|HIGH|LOW at submission), quotedCutBps, quotedFeeBps, status, availableUntil (Lagos date), minOrderQty, counterAskKobo, rejectionReason }`; **LotContribution** `{ lotId, farmerUserId, quantity }` (one row per lot in Phase 3: the submitting farmer); **LotPhoto** `{ lotId, storageKey, position }` (private bucket, signed links); **LotFeeTerms** `{ lotId, cooperativeCutBps, platformFeeBps, lockedAt }` locked at approval from the quoted terms; **LotRevision** `{ lotId, askKobo, quantity, floorKobo, status: PENDING|APPROVED|REJECTED|SUPERSEDED }`.
- **CatalogRequest** `{ kind: CROP|UNIT, name, nameKey, cooperativeId, status: WITH_OFFICER|FORWARDED|DECLINED|APPROVED, resolvedItemId }`: a farmer's request for a missing crop or unit; officers forward it, board admins add it.
- **Offer** `{ lotId, cooperativeId, buyerUserId, quantity, offeredKobo, counterKobo, agreedKobo, status, expiresAt, acceptedAt, payByAt, referredByUserId, decidedByUserId }`, every kobo value per unit. Rate limits: 10 offers a buyer an hour, 5 per lot a day, counted in Postgres. A paid offer becomes ORDERED (Phase 5). **StockReservation** `{ lotId, orderId, quantity, countsTowardStock, expiresAt }`: 15 minutes from checkout; `countsTowardStock` is false for a checkout from an accepted offer, which already holds its stock. **Committed stock** (`catalog/stock.ts` `committedQuantity`) is computed, never decremented: sold orders (by delivered quantity once set) + live counting reservations + ACCEPTED offers with `payByAt` in the future. Checkouts, acceptances, payment confirmation and revisions all lock the lot row before counting it.
- **Order** `{ lotId, cooperativeId, buyerUserId, offerId?, quantity, unitKobo, cutBps, feeBps, deliveryMethod: PICKUP|DELIVERY, deliveryKobo, deliveryQuoteId?, totalKobo, status, cancelReason, paidAt, deliveryDate, deliveredQuantity, ... }`: one lot per order (the planned OrderLine is folded in); the lot's locked terms are copied at checkout. Order-level kobo (`totalKobo`, `deliveryKobo`, payment, refund and ledger amounts) are Postgres BIGINT, crossing the boundary only through `koboFromDb` / `koboToDb` in `money.ts`. **DeliveryQuote** `{ lotId, cooperativeId, buyerUserId, amountKobo, note, expiresAt }`: an officer's delivery cost for one buyer, valid 48 hours, used by at most one order; it is posted to the buyer's lot thread.
- **Payment** `{ orderId, reference unique (pay_<orderId>), amountKobo, status: INITIALIZED|SUCCEEDED|FAILED, paystackTransactionId, feesKobo, channel }`; **PaystackEvent** `{ eventKey unique (event:data.id), event, reference, payload (trimmed: event, reference, status, amount, currency), outcome }`; **LedgerEntry** `{ orderId, groupId, kind, account, recipientRef, amountKobo (signed, debit positive) }`: append-only by trigger, no foreign keys, each group sums to zero; **Refund** `{ orderId, purpose (unique per order: late, cancel, shortfall, dispute), reason, amountKobo, status: PENDING|PROCESSED|FAILED, paystackRefundId }`; **Payout** `{ orderId, recipientType: COOPERATIVE|FARMER, recipientId, bankOwnerId, part, amountKobo, recipientCode (fixed at release), reference unique (po_<orderId>_<c|f>_<recipientId>_<part>, lowercase), status: QUEUED|SENT|PAID|FAILED|BLOCKED, sendableAt (payment + 24 h), balanceRefusals, paidAt }`, one per recipient and transfer part of at most ₦10,000,000, created only on completion; **PayoutAttempt** `{ payoutId, attempt, transferReference unique (<payout reference>-<attempt>), transferCode, status: SENT|SUCCEEDED|FAILED|REVERSED, failureReason }`, one Paystack transfer each; **Dispute** `{ orderId, kind: REPORT|TIMEOUT|SUSPENSION|AFTER_COMPLETION, reason, status: OPEN|RESOLVED, outcome: RELEASE|REFUND_ALL|REFUND_UNITS|NOTE, unitsRefunded, decisionNote, decidedByUserId }`; **ReconciliationIssue** `{ kind, reference (unique with kind), orderId, detail (ids, amounts, statuses only), resolvedAt, resolutionNote }`. Order also carries `cancelRequestedAt` and `cancelledByCooperative`.
- **Thread** `{ kind: BUYER_COOPERATIVE|FARMER_COOPERATIVE, lotId, cooperativeId, counterpartUserId, lastMessageAt }` (one per lot and buyer, one per lot for the farmer; order threads in Phase 5); **Message** `{ threadId, authorUserId, side: BUYER|COOPERATIVE|FARMER|ADMIN, body }` (1 to 2000 characters; phone numbers and emails refused; a cooperative-side message to a buyer naming the floor refused; 30 a person an hour); **Review**; **Report**; **Dispute**; **Notification**.
- **InputOrder**, **InputSignup**, **Loan** (tracking only).
- **NameChangeRequest** `{ subjectType: USER|COOPERATIVE, subjectId, fromName, toName, reason, documentKind, storageKey (private bucket), status: PENDING|APPROVED|REJECTED|WITHDRAWN, requestedByUserId, decidedByUserId, rejectionReason }`: at most one PENDING per subject (partial unique index). Nobody renames themselves: an admin who is not involved approves, which updates `User.name` or `Cooperative.name` and never the payout account. While one is pending no bank change can start or be confirmed for that subject, and a name change is refused while a bank change is in flight. Both sides check and write under one per-subject Postgres advisory lock (`src/lib/subject-lock.ts`), and an approval re-checks that no bank change is in flight.
- **AuditLog** (append-only), **JobRun** `{ key unique }`, **Setting** `{ key, value }`: `platform_fee_bps` (default "300"), `max_cooperative_cut_bps` ("500"), `price_deviation_bps` ("2000"); later, timeouts. The value is a string of integer basis points, parsed only by `parseBps` in `src/lib/money.ts`; a missing row means the default in `settings/service.ts`.

## 6. State machines

- **Cooperative:** PENDING -> VERIFIED <-> SUSPENDED. Verification lapses at `certificateExpiresAt`.
- **Lot:** PENDING_REVIEW -> (COUNTERED | REJECTED | LIVE); COUNTERED -> (LIVE when the farmer accepts | WITHDRAWN when they decline); PENDING_REVIEW, COUNTERED or LIVE -> (WITHDRAWN | EXPIRED); LIVE -> SOLD_OUT (Phase 5). There is no server-side draft: the unsent form is kept in the browser. Editing a live lot's price, quantity or floor creates a pending revision; the live version stays until approved, and the locked fee terms never change.
- **Offer:** OPEN -> (ACCEPTED at or above the floor | AWAITING_FARMER below it | REJECTED | COUNTERED | EXPIRED | WITHDRAWN); AWAITING_FARMER -> (ACCEPTED | REJECTED | EXPIRED | WITHDRAWN); COUNTERED -> (ACCEPTED at the counter | WITHDRAWN | EXPIRED); ACCEPTED -> EXPIRED at `payByAt` (until Phase 5 turns it into a checkout). Buyers see AWAITING_FARMER as waiting, with an unchanged expiry, and any rejection as declined. Accepted offers hold stock for 24 hours.
- **Order** (`orders/state.ts`): PENDING_PAYMENT -> (PAID_HELD | CANCELLED | REFUNDED); CANCELLED -> (PAID_HELD | REFUNDED) only for a payment that lands after the unpaid order expired; PAID_HELD -> (PREPARING | DELIVERED_MARKED | REFUNDED | DISPUTED | TIMED_OUT); PREPARING -> (DELIVERED_MARKED | REFUNDED | DISPUTED | TIMED_OUT); DELIVERED_MARKED -> (COMPLETED | DISPUTED); DISPUTED -> (COMPLETED | REFUNDED); TIMED_OUT -> (COMPLETED | REFUNDED | DELIVERED_MARKED). Payouts are created only on the transition to COMPLETED, by server code. The officer marks delivered from PAID_HELD, PREPARING or TIMED_OUT (late; closes the timeout); the buyer confirms only DELIVERED_MARKED; a report freezes the order (DISPUTED) until an admin decides; a suspended cooperative's open orders are frozen with a SUSPENSION dispute. A buyer may cancel PAID_HELD at once, and only ask once PREPARING.
- **Payout:** QUEUED -> SENT (a new attempt) -> PAID; SENT -> FAILED (Paystack failed or reversed it) -> QUEUED by an admin's retry (new attempt and reference); a low balance sends it back to QUEUED for the next day; BLOCKED (no account, or the farmer is no longer an active member) -> QUEUED by an admin once an account exists. A transfer Paystack answers pending or OTP, or never answers, stays SENT and is never sent again until Paystack says it failed.

## 7. Money flow

1. `orders.service.startCheckout` reserves stock (15 minutes, row lock) and initializes a Paystack transaction for 100% of the total (channels card, bank transfer, USSD).
2. `POST /api/paystack/webhook` checks the HMAC-SHA512 signature of the raw body (keyed by `PAYSTACK_SECRET_KEY`), records the `PaystackEvent` once, verifies the transaction with Paystack (status success, exact amount, NGN), then, under the lot's row lock, moves the order to PAID_HELD and writes ledger entries, or refunds the whole payment if its stock went to another buyer meanwhile. The work happens before the response; if Paystack cannot be reached the event is kept for retry and the answer is 500, so Paystack redelivers. The buyer's return from Paystack never marks anything paid.
3. On completion (the buyer confirms, the daily job 72 hours after the delivery mark, or an admin's decision) `orders/complete.ts` refunds any units not delivered at the unit price, writes the release from the order's copied terms on the delivered units (`order.released`: HELD to COOPERATIVE_PAYABLE (cut + delivery), FARMER_PAYABLE (by contribution) and PLATFORM_FEE), and creates the payouts in the same transaction. The account is `effectiveRecipientCode(owner, completedAt)`: a bank change still inside its 48 hours pays the old account. Payouts are sent by Paystack transfer once the payment is 24 hours old (at release, or by the daily job); each success writes `payout.paid` (payable to PAYSTACK_BALANCE). Paystack's processing fee stays on AgroHub's side (PAYSTACK_FEES). Cancellations and admin full refunds write `refund.issued`; Paystack's refund webhook writes `refund.processed`.
4. Invariants, enforced by tests (`money-invariants.test.ts` drives random orders through every path): per order, ledger entries sum to zero; once everything settles HELD and every payable are zero; payouts plus platform fee equal the amount paid minus refunds; no recipient has two payouts for one part, and each payout has exactly one successful attempt.
6. Reconciliation (daily) confirms Paystack successes whose webhook never came, checks transfers awaiting Paystack for over an hour, resends refunds Paystack never received, checks every recently touched ledger sums to zero, and records what it cannot settle as a `ReconciliationIssue` for the admin queue (emailed once).
5. The payout method (transfers or Paystack manual settlement) is isolated behind `payments/payout-gateway.ts`, so it can change after Paystack answers without touching the order logic.

## 8. Integrations

| Service | Used for | Boundary |
| --- | --- | --- |
| Paystack | checkout, webhooks, refunds, transfer recipients, transfers | `src/lib/paystack.ts` (thin client and fake), `modules/payments`, `app/api/paystack/webhook/route.ts` |
| Resend | all email | `src/lib/email.ts` with a fake transport for tests and local |
| Private bucket (S3-compatible: Backblaze B2, R2 or S3) | verification documents, lot photos | `src/lib/storage.ts`, signed URLs only |
| Vercel Cron | scheduled jobs | `app/api/cron/[job]/route.ts` guarded by `CRON_SECRET` |

Scheduled jobs: offer expiry (`offer-expiry`, daily 04:30 UTC; every action also refuses an expired offer before it runs), unpaid-order expiry (`order-expiry`, daily 04:45 UTC: checkouts unpaid for 24 hours are cancelled; reservations already stop counting after 15 minutes on every read), order timers (`order-timers`, daily 05:30 UTC: auto-release 72 hours after a delivery mark, so up to a day late; orders paid 14 days ago and never marked delivered become TIMED_OUT for an admin), payouts (`payouts`, daily 06:30 UTC: payouts whose funds have cleared, and those deferred for a low balance), reconciliation (`reconciliation`, daily 07:00 UTC), lot expiry, certificate reminders. Each is wrapped in `runOnce`. Admin alert emails (payout failed or blocked, low balance after 3 refusals, refund failed, transfers awaiting Paystack over 3 days, reconciliation issues) go to every active admin and carry ids and amounts only.

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

Paystack's written answer on holding funds and manual settlement; brand identity; weather alerts (deferred).

Decided (Phase 3): the AgroHub fee (default 3%) and the maximum cooperative cut (default 5%) live in the `Setting` table as basis-point strings, editable by admins at `/admin/settings`; so does the price-deviation threshold (default 20%, formerly the constant `DEFAULT_DEVIATION_THRESHOLD_BPS`, which remains as the code default). Lot photos are compressed in the browser with `<canvas>` (`src/lib/image-compress.ts`), so no image dependency was added.

## 12. Dependencies

- create-next-app tooling: next, react, react-dom, typescript, tailwindcss, eslint (+ eslint-config-next), @types/*; the app framework and lint/type tooling.
- zod: runtime validation of environment variables and, later, service input schemas.
- vitest: unit and integration test runner (resolves the `@/` alias natively).
- @playwright/test: end-to-end tests; browsers are installed separately when first needed.
- fast-check (dev): property-based tests, e.g. money splits always sum exactly to the total.
- resend: sends transactional email (verification and later notifications) in staging and production; local and tests use the in-memory fake outbox.
- @aws-sdk/client-s3: S3-compatible client (Backblaze B2, Cloudflare R2 or AWS S3) that uploads private documents and photos in staging and production; local and tests use the in-memory fake storage.
- @aws-sdk/s3-request-presigner: creates the short-lived signed GET links through which private objects are opened.
- prisma (dev) and @prisma/client: schema, migrations and the typed database client; Prisma 7 reads `prisma.config.ts` and never loads `.env`.
- @prisma/adapter-pg: the node-postgres driver adapter Prisma 7 needs to connect to Postgres (local Docker and Neon).
- better-auth: email and password login, email verification and sessions (its two-factor plugin provides TOTP; admin and board-admin enforcement is via `requireSecondFactor` in `getActor`, and pages use `requireActorForPage` to send them to `/two-factor`), stored through its Prisma adapter. Its `nextCookies` plugin (kept last) lets `auth.api` calls in server actions set cookies; the browser pages use its React client (`src/lib/auth-client.ts`).
- @tailwindcss/turbopack (dev): the Tailwind CSS v4 integration for Next.js Turbopack builds.
- auth (dev): the Better Auth CLI; `auth generate` writes Better Auth's models into `prisma/schema.prisma`. Run it only through `npm run auth:generate`, which uses an empty temp cwd so the CLI never loads `.env`.
- next-intl: message loading and translations for the App Router; locale comes from a `locale` cookie (no locale-prefixed routing), and only locales listed in `enabledLocales` are ever served.
- qrcode (+ @types/qrcode, dev): draws the two-factor setup QR code as an SVG in the browser, so the TOTP secret is never sent to a QR service.
- tsx (dev): runs TypeScript scripts with the `@/` alias, for `npm run admin:grant` (`scripts/grant-role.ts`). It never loads `.env`.
