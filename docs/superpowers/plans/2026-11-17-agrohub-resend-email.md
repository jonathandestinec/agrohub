# AgroHub Resend Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make email fully functional on the verified Resend domain `agro-hub.com.ng`: real sender, password reset, and emails for the key events that are in-app-only today.

**Architecture:** One branch, one PR, three parts. Part 1 swaps the placeholder sender and makes the Resend transport skip reserved-domain addresses (seed accounts). Part 2 adds Better Auth `sendResetPassword` plus two pages. Part 3 adds `src/modules/notifications/alert-emails.ts`: a helper called by the services right after their transaction commits, next to where `notify` is called. `notify` and `notifications/service.ts` stay untouched, so a mail failure can never roll back or block a business action.

**Tech Stack:** Next.js, Prisma, Better Auth, Resend, Vitest, Playwright. No new dependency, no migration expected.

**Spec:** `docs/superpowers/specs/2026-10-31-agrohub-design.md` §6.11 (every key event emails the people involved); `docs/superpowers/specs/2026-11-10-in-app-alerts-design.md` §2 (event emails deferred until the Resend domain existed); `docs/environments.md`.

## Global Constraints

- Money is integer kobo; formatting only through `src/lib/money.ts`.
- Business logic only in `src/modules/*/service.ts`; components and routes call services.
- Private fields (floor price, phone numbers, bank data) never appear in an email. Alert emails are built only from the typed `data` shapes in `src/modules/notifications/schema.ts`, which have no such field.
- User-facing copy never says "escrow". Say "payment held until delivery is confirmed".
- Never log secrets, recipient addresses, or email html. Failures log `{ kind, id, error: { name, message } }` only, as `logEmailFailure` in banking does.
- Tests and staging use Paystack test keys only. No Vercel env var or secret is set by this work; the user does that.
- No new dependency without a line in `docs/architecture.md`.
- Test first, commit per task, `npm run lint`, `npm run typecheck`, `npm test` before each commit. Searches and test runs go to the `search`, `grep`, `audit`, `test` subagents.

## Review Focus

- Email send throws (Resend down, bad key): the business action still succeeds and nothing sensitive is logged. Tested per wired site in Task 5 and Task 6.
- The same event reached twice (webhook plus reconciliation; replayed Paystack event): exactly one email. Sites send only on the branch where the conditional update changed a row; tested in Task 5.
- Password reset for an unknown email: identical response to a known email, and no email sent. Task 3.
- Reset link reused or expired: the page shows a clear error and offers a new request. Task 3.
- Seeded accounts on staging (`@example.com`): no real send, no bounce. Task 1.
- Per-address reset limiting does not stop one sender spraying many different addresses; only Better Auth's in-memory per-IP limiter guards that today. Stated in the PR.
- Reset after sign-in with two-factor on: password reset must not bypass two-factor; sign-in afterwards still asks for the code (Better Auth behaviour, asserted in Task 3).

## Design decisions (spec silent; each repeated in the PR description)

1. **Seed safety: skip rule, not new addresses.** `prisma/seed.ts` uses seven `@example.com` addresses (`seed-admin`, `seed-board`, `seed-officer`, `seed-farmer`, `seed-buyer`, `seed-buyer2`, `seed-grower`), and those rows already exist in the staging DB. Rewriting them would need a data change on staging. `example.com`, `.org` and `.net` are reserved (RFC 2606), so the real Resend transport skips any recipient on a reserved domain (`example.com|org|net`, and TLDs `.test`, `.example`, `.invalid`, `.localhost`) and logs only `email skipped: reserved domain`. The fake outbox still records them, so every existing test is unchanged. Skipped sends count as success for callers.
2. **Alert emails sent after commit, from the call site, not inside `notify`.** `notify` runs inside the caller's transaction; an email sent there would go out for a change that later rolls back. Each wired site calls `sendAlertEmail(...)` after its transaction, on the same changed-one-row branch, passing the same `kind`, `data` and recipient list it gave `notify` (same recipient helpers from `notifications/recipients.ts`). Rejected alternative: hooking `notify` itself, which would couple the in-transaction write to a network call.
3. **One generic template per kind, from the existing alert sentences.** Subject and body come from the same copy the bell uses (`messages/en.json` `alerts`), plus a button linking to the same `href` the bell builds in `views.ts`, made absolute with `BETTER_AUTH_URL`. No new copy to keep in sync; "escrow" is already barred by the existing unit test, which is extended to the email output.
4. **Password reset keeps Better Auth's default one-hour token** and revokes other sessions on reset.
5. **Mail failures are logged, never retried.** No queue in this stage (simpler; a lost email never blocks anything, and the in-app alert is the record). A 429 from Resend is just a logged failure.
6. **Mail never blocks a response.** `src/lib/defer.ts` exports `deferWork(task: () => Promise<void>): Promise<void>`: it hands the task to Next's `after()` (from `next/server`, Next 16.4.3 installed) and resolves at once; `after()` works anywhere inside a route handler, server action or server component call stack, which covers the webhook, the crons and the actions. Outside a request scope (Vitest, `tsx` seed) `after()` throws, so `deferWork` catches that and runs the task inline and awaited. Call sites `await sendAlertEmail(...)`, which is instant in production and deterministic in tests. A unit test pins both branches (the `after()` branch with `next/server` mocked). Better Auth awaits `sendResetPassword` inline unless `advanced.backgroundTasks.handler` is set, so `auth.ts` sets it to schedule the promise with `after()` (ignoring the throw outside a request scope).
7. **Sends are sequential, in one deferred task.** `sendAlertEmail` schedules ONE `deferWork` task that loops over the recipients and awaits each send in turn (never one `deferWork` per recipient, which would run them concurrently inside `after()`). `deferWork` catches only `after()`'s "outside a request scope" error and runs inline; any other error from `after()` is logged and the task still runs inline. The "max one in flight" test covers both the deferred and the inline path. Previously: **Sends are sequential** (one in flight), not `Promise.allSettled`, to stay under Resend's rate limit. `docs/environments.md` notes that Resend's free plan caps daily volume (about 100 a day) and the user should check their plan.
8. **Reset abuse limit: DB count, no migration.** Better Auth's built-in limiter on `/request-password-reset` is 3 per 60 s per IP, production only, in memory (per instance on Vercel), and keyed by IP, not address. Its database storage needs a new `rateLimit` table (a migration). Instead `sendResetPassword` counts the `verification` rows Better Auth already wrote for that user in the last hour (identifier `reset-password:…`, value the user id) and skips the send when more than 3 exist. That holds across instances, needs no migration, and the response stays identical because the skip happens after the response body is decided. Logged as `password reset throttled` with no address. The in-memory IP limiter stays as is.
9. **Payment-code edits are additive only.** The post-commit email call is added; no transaction, ledger, conditional-update or Paystack logic is reordered or changed. If a site cannot be wired without restructuring, work stops and is reported. Those edits are their own commit (Task 5a).

## Proposed events to email (trim before building)

Already emailed today and unchanged (no duplicates): cooperative status, membership decisions, farmer invites, bank change confirm and admin alert, certificate expiry, admin payout/reconciliation problems.

**Core (included unless you strike them):**

| Event (alert kind) | Who is emailed | Notes |
|---|---|---|
| `PAYMENT_CONFIRMED` | buyer | "payment held until delivery is confirmed". This is the "order paid" email for the buyer. "Order placed" has no alert kind of its own (checkout is not a confirmed event), so the paid email covers it |
| `ORDER_PAID` | officers | order needs preparing |
| `LOT_ORDER_PAID` | farmers of the lot | prepare their share |
| `DELIVERY_DATE_SET` | buyer | |
| `ORDER_DELIVERED` | buyer | asks them to confirm receipt |
| `ORDER_RECEIPT_CONFIRMED` | officers | |
| `PAYOUT_SENT` | officers (cooperative payout) or the farmer | failures stay admin-only, as today |
| `REFUND_SENT` | buyer | |
| `ORDER_PROBLEM_REPORTED` | officers and admins | dispute opened |
| `DISPUTE_RESOLVED` | buyer and officers | dispute ruled |
| `NAME_CHANGE_APPROVED` / `NAME_CHANGE_REJECTED` | the person, or the cooperative's officers | |

**Added at review (approved: "add offer/lot emails"):** `OFFER_ACCEPTED`, `OFFER_COUNTERED` (buyer); `LOT_APPROVED`, `LOT_REJECTED` (farmers of the lot). Wired in Task 5b.

**Excluded (still your call):** `OFFER_RECEIVED` (officers); `OFFER_DECLINED` (buyer); `LOT_COUNTERED` (farmers); `ORDER_CANCELLED_BY_BUYER`, `ORDER_CANCELLED_BY_COOPERATIVE`, `CANCEL_REQUEST_AGREED`, `CANCEL_REQUEST_REFUSED`; `ORDER_EXPIRED`; `DELIVERY_QUOTED`. Each is one more entry in the kind list in Task 4 and one more call.

**Never emailed:** `MESSAGE_RECEIVED`, `ORDER_PREPARING`, catalog requests, farmer-asked-to-join, lot submitted/withdrawn/revision kinds, price alerts.

## File Structure

- Modify `src/lib/email.ts`, `src/lib/env.ts`: sender default, reserved-domain skip.
- Create `src/lib/email-recipients.ts`: `isReservedDomain(address: string): boolean`.
- Modify `src/lib/auth.ts`: `sendResetPassword`, `revokeSessionsOnPasswordReset`.
- Modify `src/modules/notifications/emails.ts`: `passwordResetEmail`, `alertEmail`.
- Create `src/modules/notifications/alert-emails.ts`: `sendAlertEmail`, `EMAILED_KINDS`.
- Create `src/app/(auth)/forgot-password/{page,form}.tsx`, `src/app/(auth)/reset-password/{page,form}.tsx`.
- Modify `src/app/(auth)/sign-in/sign-in-form.tsx`: "Forgot password?" link; `messages/en.json`: copy.
- Modify the services listed in Tasks 5 and 6.
- Modify `.env.example`, `docs/environments.md`, `docs/architecture.md`.
- Tests: `tests/unit/email.test.ts`, `tests/unit/alert-emails.test.ts`, `tests/integration/alert-emails.test.ts`, `tests/e2e/password-reset.spec.ts`.

---

### Task 1: Sender, env docs, reserved-domain skip

**Files:** modify `src/lib/email.ts:14`, `src/lib/env.ts:31`, `.env.example`, `docs/environments.md` (Email sender and Variables sections); create `src/lib/email-recipients.ts`; test `tests/unit/email.test.ts`.

**Interfaces:**
- Produces: `DEFAULT_FROM = "AgroHub <noreply@agro-hub.com.ng>"` defined once in `src/lib/env.ts`, imported by `email.ts`; `isReservedDomain(address: string): boolean`; `sendEmailWith` on the `"resend"` transport returns without calling Resend when the address is reserved.

- [ ] **Step 1: Write failing tests** in `tests/unit/email.test.ts`: `isReservedDomain("a@example.com")`, `("a@sub.example.org")`, `("a@x.test")` are true; `("a@gmail.com")` and `("a@agro-hub.com.ng")` are false; case-insensitive. With a stubbed Resend client, `sendEmailWith({appEnv:"staging",...resendApiKey:"k"}, {to:"seed-buyer@example.com",...})` makes zero client calls and resolves; a real address makes one call with `from: "AgroHub <noreply@agro-hub.com.ng>"`; the fake transport still records an `@example.com` message.
- [ ] **Step 2: Run** `npx vitest run tests/unit/email.test.ts` via the `test` subagent. Expected: FAIL.
- [ ] **Step 3: Implement** the three changes above; skip path logs `console.info("email skipped: reserved domain")` with no address.
- [ ] **Step 4: Docs.** `.env.example` gains `EMAIL_FROM="AgroHub <noreply@agro-hub.com.ng>"` with a comment; `docs/environments.md` states the default, that the domain is verified in Resend (eu-west-1), and lists exactly what the user sets in Vercel: `RESEND_API_KEY` (Sensitive; a Resend key with sending access to `agro-hub.com.ng`) and `EMAIL_FROM` = `AgroHub <noreply@agro-hub.com.ng>`, each for **Preview** and **Production**, then redeploy. Also document the reserved-domain skip and that seeded accounts never receive real mail.
- [ ] **Step 5: Run** lint, typecheck, tests (`test` subagent). Expected: all pass. Commit `feat: send from agro-hub.com.ng and skip reserved-domain recipients`; message records design decision 1.

### Task 2: Reset-password server side and email

**Files:** modify `src/lib/auth.ts` (inside `emailAndPassword`, lines ~31-34), `src/modules/notifications/emails.ts`; test `tests/unit/emails.test.ts`, `tests/integration/auth-reset.test.ts`.

**Interfaces:**
- Produces: `passwordResetEmail(input: { name: string; link: string }): { subject: string; html: string }`; auth config `sendResetPassword: async ({ user, url }) => …` and `revokeSessionsOnPasswordReset: true`.

- [ ] **Step 1: Write failing tests.** Unit: `passwordResetEmail({name:"Ada <b>", link:"https://x/y?token=a&b=1"})` escapes name and link, subject is `Reset your AgroHub password`, no "escrow". Integration: calling the Better Auth request-reset endpoint for a seeded verified user puts exactly one message in `fakeOutbox` with a link containing `token=`; for an unknown address it puts none and the response body and status equal the known-address response.
- [ ] **Step 2: Run** the two files via `test` subagent. Expected: FAIL.
- [ ] **Step 3: Implement** `passwordResetEmail` (reuse the file's private `escapeHtml`), `emailAndPassword.sendResetPassword`, `revokeSessionsOnPasswordReset: true`, and `advanced.backgroundTasks.handler` (decision 6). In `sendResetPassword`, first apply the throttle (decision 8): count `verification` rows with identifier starting `reset-password:` and value `user.id` created in the last hour; more than 3 means log `password reset throttled` and return without sending. Failures are caught and logged (no address, no url). Better Auth 1.7.14 names: server `POST /request-password-reset`, client `authClient.requestPasswordReset`.
- [ ] **Step 3b:** extra tests in the same files: a fourth reset request within the hour sends no email and returns the same body as the first; with the transport throwing, the request still returns 200.
- [ ] **Step 4: Run** tests, lint, typecheck. Commit `feat: password reset email`.

### Task 3: Forgot and reset pages, sign-in link, e2e

**Files:** create `src/app/(auth)/forgot-password/page.tsx` and `form.tsx`, `src/app/(auth)/reset-password/page.tsx` and `form.tsx`; modify `src/app/(auth)/sign-in/sign-in-form.tsx`, `messages/en.json`; test `tests/e2e/password-reset.spec.ts`.

**Interfaces:**
- Consumes: `AuthCard`, `Field`, `FormError`, `SubmitButton` from `src/components/auth-ui.tsx`; `authClient` from `src/lib/auth-client`.
- Produces: routes `/forgot-password` (email form; always shows "If an account exists for that address, we have sent a link", never branching on the response) and `/reset-password?token=…` (new password plus confirm, min length matching sign-up; success goes to `/sign-in` with a notice; `?error=INVALID_TOKEN` or a failed submit shows "This link has expired or was already used" with a link to `/forgot-password`). `redirectTo` is the app's own `/reset-password` path only, never taken from user input.

- [ ] **Step 1: Write the failing e2e** (`password-reset.spec.ts`): sign up and verify a user (helper from `tests/e2e/auth.spec.ts`); open `/sign-in`, click "Forgot password?", submit the email; expect the generic confirmation; read the link from `/api/dev/outbox` (same polling and `&amp;` handling as `verificationLink`); open it, set a new password, sign in with it; old password fails; reusing the same link shows the expired message; an unknown email shows the identical confirmation and adds nothing to the outbox; a user with two-factor enrolled still lands on `/two-factor` after reset.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/password-reset.spec.ts` via `test` subagent. Expected: FAIL.
- [ ] **Step 3: Implement** the pages in the existing kit; copy in `messages/en.json`; link under the password field on sign-in.
- [ ] **Step 4: Run** the spec, then lint, typecheck, full tests. Commit `feat: forgot and reset password pages`.

### Task 4: Alert email helper

**Files:** create `src/lib/defer.ts` (created in Task 2 because `auth.ts` needs it), `src/modules/notifications/alert-emails.ts`; modify `src/modules/notifications/emails.ts`; tests `tests/unit/alert-emails.test.ts`, `tests/integration/alert-emails.test.ts`.

**Interfaces:**
- Consumes: `AlertKind`, `AlertData` from `schema.ts`; `Recipient` from `recipients.ts`; link builder from `views.ts`; `sendEmail`.
- Produces: `EMAILED_KINDS: ReadonlySet<AlertKind>` (the approved list above); `alertEmail(kind, data, href): { subject: string; html: string }` in `emails.ts`; `sendAlertEmail<K extends AlertKind>(db: Db, input: { kind: K; subject: { type: NotificationSubjectType; id: string }; data: AlertData[K]; to: Recipient[]; exclude?: string | null }): Promise<void>`. It validates `data` with the same schema as `notify`, drops `exclude`, looks up emails for the user ids, sends them one at a time through `deferWork` (decision 6, 7), logs failures as `{ kind, subjectId, error }`, never throws, and does nothing for a kind outside `EMAILED_KINDS` or an empty list.

- [ ] **Step 1: Write failing tests.** Unit: every kind in `EMAILED_KINDS` yields a subject, a body with an absolute link on `BETTER_AUTH_URL`, no "escrow", and none of the strings `floor`, `phone`, `bank account`; `PAYMENT_CONFIRMED` body contains "held until delivery is confirmed". Integration: one send per recipient, actor excluded, user with `@example.com` handled via fake outbox, a throwing transport does not throw and the log call contains neither the address nor the html.
- [ ] **Step 2: Run** via `test` subagent. Expected: FAIL.
- [ ] **Step 3: Implement** as specified (and `src/lib/defer.ts`); one body template parameterised by the existing `alerts` sentence for the kind. `EMAILED_KINDS` includes the five added at review.
- [ ] **Step 3b:** `tests/unit/defer.test.ts`: with `next/server` mocked so `after` records its argument, `deferWork` calls it and resolves without running the task; with `after` throwing, the task runs inline and is awaited; a throwing task never rejects. Sends are sequential (assert max one in flight).
- [ ] **Step 4: Run** tests, lint, typecheck. Commit `feat: alert email helper`.

### Task 5a: Wire payment, payout, refund and dispute events (own commit, additive only)

**Files:** modify `src/modules/orders/alerts.ts` (add `emailOrder` beside `notifyOrder`, same audience argument; this is new code, not a change to `notifyOrder`), `src/modules/payments/payments.ts:116-118`, `src/modules/orders/disputes.ts:63,223`, `src/modules/payments/alerts.ts:64-86` (`notifyPayoutSent`, `notifyRefundSent`); test `tests/integration/order-emails.test.ts`.

**Rule:** only add the post-commit call. "Hoisting data" is allowed only as returning extra values from the existing transaction callback; no write, read-then-write or conditional update moves in or out of a transaction. `PAYOUT_SENT` and `REFUND_SENT` must be wired at the point of Paystack's confirmed success (`transfer.success`, refund processed), verified in code before wiring; if they fire at transfer start, wire at the confirmed point (still additive) or report back. Do not reorder, restructure, or alter any transaction, ledger, conditional update or Paystack logic. If a site cannot be wired that way, stop and report to the starting session. This commit is read in isolation by the Opus review.

**Interfaces:**
- Consumes: `sendAlertEmail` (Task 4).
- Produces: `emailOrder(db, order, kind, data, audience)` mirroring `notifyOrder`'s signature, called after the transaction on the branch where the conditional update changed one row.

- [ ] **Step 1: Write failing tests**, one per core order kind: the right people get exactly one email with the order link; replaying the same Paystack `charge.success` and a reconciliation run after the webhook send no second email; a throwing transport leaves the order paid/delivered/resolved; a late payment that is refunded instead emails no "prepare" mail; when the webhook never arrived and the daily reconciliation is the first confirmer, the buyer, officers and farmers each get exactly one email (and the webhook-first test stays, with reconciliation sending nothing).
- [ ] **Step 2: Run** via `test` subagent. Expected: FAIL.
- [ ] **Step 3: Implement** by adding the post-commit call at each site above. Where a site's `notify` is currently inside the transaction, hoist the data needed and call `emailOrder` after the transaction returns.
- [ ] **Step 4: Run** tests, lint, typecheck. Commit `feat: email payment, payout, refund and dispute events`.

### Task 5b: Wire delivery, offer and lot events

**Files:** modify `src/modules/orders/delivery.ts:90,113,124`, `src/modules/marketplace/negotiation.ts:94` (`tellBuyer`: only `OFFER_ACCEPTED`, `OFFER_COUNTERED`), `src/modules/catalog/screening.ts:105` (`tellFarmers`: only `LOT_APPROVED`, `LOT_REJECTED`); tests `tests/integration/delivery-emails.test.ts`, `tests/integration/offer-lot-emails.test.ts`.

- [ ] **Step 1: Write failing tests:** delivery date set / delivered / receipt confirmed email the right people once; an accepted or countered offer emails the buyer, a declined one does not; an approved or rejected lot emails every farmer with a contribution, a countered one does not; transport failure leaves each action saved; the offer note and floor price never appear in the body.
- [ ] **Step 2: Run** via `test` subagent. Expected: FAIL.
- [ ] **Step 3: Implement** the post-commit `sendAlertEmail` call beside each `notify`.
- [ ] **Step 4: Run** tests, lint, typecheck. Commit `feat: email delivery, offer and lot events`.

### Task 6: Wire name-change events

**Files:** modify `src/modules/name-changes/service.ts:410,450,476`; test `tests/integration/name-change-emails.test.ts`.

- [ ] **Step 1: Write failing tests:** approving or rejecting a personal name change emails that person; a cooperative rename emails its active officers; neither fires on a second decision attempt; transport failure leaves the decision saved.
- [ ] **Step 2: Run** via `test` subagent. Expected: FAIL.
- [ ] **Step 3: Implement** the post-commit `sendAlertEmail` call next to the existing `notify`, same recipient list.
- [ ] **Step 4: Run** tests, lint, typecheck. Commit `feat: email name change decisions`.

### Task 7: Docs, full verification, PR

**Files:** modify `docs/architecture.md` (notifications module now sends event emails after commit via `deferWork`; reserved-domain skip), `docs/environments.md` (Resend free plan caps daily volume at about 100; check the plan).

- [ ] **Step 0: Local click-through** on a local dev server (never on agrohub-theta.vercel.app), locally created test accounts, built-in browser pane. Script: sign up and verify a test user (link from `/api/dev/outbox`); sign in; click "Forgot password?"; request a reset; open the link from the outbox; set a new password; sign in with it; then drive one order event (a buyer's paid order) and confirm its email in the outbox. Steps, results and screenshots go in the PR description.
- [ ] **Step 1:** Run lint, typecheck, `npm test` (with `--testTimeout=60000` for `reconciliation`), and `npx playwright test` through the `test` subagent. Known flaky: `buyer-join` integration, `cooperative-to-farmer` e2e bank step; rerun those once and report honestly.
- [ ] **Step 2:** Run the `audit` subagent on the committed diff; fix findings, recommit.
- [ ] **Step 3:** Push the branch, open the PR against `main` (no AI attribution). Description lists: which subagent ran each search and each test run (and any done without one), the design decisions above, the exact Vercel variables to set for Preview and Production (`RESEND_API_KEY`, `EMAIL_FROM`), and "no migration". Stop; do not merge.
