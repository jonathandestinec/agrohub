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
- Reset after sign-in with two-factor on: password reset must not bypass two-factor; sign-in afterwards still asks for the code (Better Auth behaviour, asserted in Task 3).

## Design decisions (spec silent; each repeated in the PR description)

1. **Seed safety: skip rule, not new addresses.** `prisma/seed.ts` uses seven `@example.com` addresses (`seed-admin`, `seed-board`, `seed-officer`, `seed-farmer`, `seed-buyer`, `seed-buyer2`, `seed-grower`), and those rows already exist in the staging DB. Rewriting them would need a data change on staging. `example.com`, `.org` and `.net` are reserved (RFC 2606), so the real Resend transport skips any recipient on a reserved domain (`example.com|org|net`, and TLDs `.test`, `.example`, `.invalid`, `.localhost`) and logs only `email skipped: reserved domain`. The fake outbox still records them, so every existing test is unchanged. Skipped sends count as success for callers.
2. **Alert emails sent after commit, from the call site, not inside `notify`.** `notify` runs inside the caller's transaction; an email sent there would go out for a change that later rolls back. Each wired site calls `sendAlertEmail(...)` after its transaction, on the same changed-one-row branch, passing the same `kind`, `data` and recipient list it gave `notify` (same recipient helpers from `notifications/recipients.ts`). Rejected alternative: hooking `notify` itself, which would couple the in-transaction write to a network call.
3. **One generic template per kind, from the existing alert sentences.** Subject and body come from the same copy the bell uses (`messages/en.json` `alerts`), plus a button linking to the same `href` the bell builds in `views.ts`, made absolute with `BETTER_AUTH_URL`. No new copy to keep in sync; "escrow" is already barred by the existing unit test, which is extended to the email output.
4. **Password reset keeps Better Auth's default one-hour token** and revokes other sessions on reset.
5. **Mail failures are logged, never retried.** No queue in this stage (simpler; a lost email never blocks anything, and the in-app alert is the record).

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

**Your call (excluded by default):** `OFFER_RECEIVED` (officers); `OFFER_ACCEPTED`, `OFFER_COUNTERED`, `OFFER_DECLINED` (buyer); `LOT_APPROVED`, `LOT_REJECTED`, `LOT_COUNTERED` (farmers); `ORDER_CANCELLED_BY_BUYER`, `ORDER_CANCELLED_BY_COOPERATIVE`, `CANCEL_REQUEST_AGREED`, `CANCEL_REQUEST_REFUSED`; `ORDER_EXPIRED`; `DELIVERY_QUOTED`. The design spec §6.11 names offers, counters and lot decisions as key events, so say if you want them; each is one more entry in the kind list in Task 4 and one more call in Task 5.

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
- [ ] **Step 3: Implement** `passwordResetEmail` (reuse the file's private `escapeHtml`) and wire `sendResetPassword` to `sendEmail`. The send is not awaited past Better Auth's own handling and a failure is caught and logged with the shared failure-log shape (no address, no url). Check the installed Better Auth version's client method name (`requestPasswordReset` vs `forgetPassword`) and callback shape in `node_modules` before Task 3.
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

**Files:** create `src/modules/notifications/alert-emails.ts`; modify `src/modules/notifications/emails.ts`; tests `tests/unit/alert-emails.test.ts`, `tests/integration/alert-emails.test.ts`.

**Interfaces:**
- Consumes: `AlertKind`, `AlertData` from `schema.ts`; `Recipient` from `recipients.ts`; link builder from `views.ts`; `sendEmail`.
- Produces: `EMAILED_KINDS: ReadonlySet<AlertKind>` (the approved list above); `alertEmail(kind, data, href): { subject: string; html: string }` in `emails.ts`; `sendAlertEmail<K extends AlertKind>(db: Db, input: { kind: K; subject: { type: NotificationSubjectType; id: string }; data: AlertData[K]; to: Recipient[]; exclude?: string | null }): Promise<void>`. It validates `data` with the same schema as `notify`, drops `exclude`, looks up emails for the user ids, sends each with `Promise.allSettled`, logs failures as `{ kind, subjectId, error }`, never throws, and does nothing for a kind outside `EMAILED_KINDS` or an empty list.

- [ ] **Step 1: Write failing tests.** Unit: every kind in `EMAILED_KINDS` yields a subject, a body with an absolute link on `BETTER_AUTH_URL`, no "escrow", and none of the strings `floor`, `phone`, `bank account`; `PAYMENT_CONFIRMED` body contains "held until delivery is confirmed". Integration: one send per recipient, actor excluded, user with `@example.com` handled via fake outbox, a throwing transport does not throw and the log call contains neither the address nor the html.
- [ ] **Step 2: Run** via `test` subagent. Expected: FAIL.
- [ ] **Step 3: Implement** as specified; one body template parameterised by the existing `alerts` sentence for the kind.
- [ ] **Step 4: Run** tests, lint, typecheck. Commit `feat: alert email helper`.

### Task 5: Wire order and payment events

**Files:** modify `src/modules/orders/alerts.ts` (add `emailOrder` beside `notifyOrder`, same audience argument), `src/modules/payments/payments.ts:116-118`, `src/modules/orders/delivery.ts:90,113,124`, `src/modules/orders/disputes.ts:63,223`, `src/modules/payments/alerts.ts:64-86` (`notifyPayoutSent`, `notifyRefundSent`); test `tests/integration/order-emails.test.ts`.

**Interfaces:**
- Consumes: `sendAlertEmail` (Task 4).
- Produces: `emailOrder(db, order, kind, data, audience)` mirroring `notifyOrder`'s signature, called after the transaction on the branch where the conditional update changed one row.

- [ ] **Step 1: Write failing tests**, one per core order kind: the right people get exactly one email with the order link; replaying the same Paystack `charge.success` and a reconciliation run after the webhook send no second email; a throwing transport leaves the order paid/delivered/resolved; a late payment that is refunded instead emails no "prepare" mail.
- [ ] **Step 2: Run** via `test` subagent. Expected: FAIL.
- [ ] **Step 3: Implement** by adding the post-commit call at each site above. Where a site's `notify` is currently inside the transaction, hoist the data needed and call `emailOrder` after the transaction returns.
- [ ] **Step 4: Run** tests, lint, typecheck. Commit `feat: email key order, payment, payout and dispute events`.

### Task 6: Wire name-change events

**Files:** modify `src/modules/name-changes/service.ts:410,450,476`; test `tests/integration/name-change-emails.test.ts`.

- [ ] **Step 1: Write failing tests:** approving or rejecting a personal name change emails that person; a cooperative rename emails its active officers; neither fires on a second decision attempt; transport failure leaves the decision saved.
- [ ] **Step 2: Run** via `test` subagent. Expected: FAIL.
- [ ] **Step 3: Implement** the post-commit `sendAlertEmail` call next to the existing `notify`, same recipient list.
- [ ] **Step 4: Run** tests, lint, typecheck. Commit `feat: email name change decisions`.

### Task 7: Docs, full verification, PR

**Files:** modify `docs/architecture.md` (notifications module now sends event emails after commit; reserved-domain skip), `docs/environments.md` if anything changed.

- [ ] **Step 1:** Run lint, typecheck, `npm test` (with `--testTimeout=60000` for `reconciliation`), and `npx playwright test` through the `test` subagent. Known flaky: `buyer-join` integration, `cooperative-to-farmer` e2e bank step; rerun those once and report honestly.
- [ ] **Step 2:** Run the `audit` subagent on the committed diff; fix findings, recommit.
- [ ] **Step 3:** Push the branch, open the PR against `main` (no AI attribution). Description lists: which subagent ran each search and each test run (and any done without one), the design decisions above, the exact Vercel variables to set for Preview and Production (`RESEND_API_KEY`, `EMAIL_FROM`), and "no migration". Stop; do not merge.
