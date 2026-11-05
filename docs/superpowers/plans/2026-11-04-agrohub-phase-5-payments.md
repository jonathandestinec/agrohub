# AgroHub Phase 5: Orders, Payment Hold, Delivery and Payouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A buyer checks out a live lot (at the asking price) or an accepted offer, with pickup or a delivery cost the officer quoted; the quantity is reserved for 15 minutes; the buyer pays 100% through Paystack; the order is marked paid only after Paystack's signed webhook and a verification call; the money stays in AgroHub's Paystack balance (payment held until delivery is confirmed); the officer schedules and marks delivery with the quantity delivered; the buyer confirms (or after 3 days it releases itself); AgroHub then pays the cooperative and each farmer by Paystack transfer exactly once, from the lot's locked terms, and keeps its fee. Cancellations, shortfalls, late duplicate payments and disputes are refunded or decided by admins, every money movement is in an append-only ledger that sums to zero per order, and a daily job reconciles against Paystack.

**Architecture:** A new `src/modules/orders` holds the order state machine (`state.ts`, pure), checkout and stock (`checkout.ts`), delivery and completion (`delivery.ts`), cancellation (`cancel.ts`), disputes (`disputes.ts`), views and jobs, exported only through `orders/service.ts`. A new `src/modules/payments` holds payment confirmation (`payments.ts`), the ledger (`ledger.ts`), refunds (`refunds.ts`), payouts (`payouts.ts`), the payout gateway (`payout-gateway.ts`, interface plus the Paystack transfer implementation) and reconciliation (`reconcile.ts`), exported through `payments/service.ts`. `src/lib/paystack.ts` gains transactions, refunds, transfers and webhook signatures, with the fake extended to match. The webhook is `src/app/api/paystack/webhook/route.ts`. Stock that is held, reserved or sold is computed in one place (`catalog` gains `committedQuantity`), which replaces Phase 4's `heldQuantity` everywhere. Money splits are pure functions in `src/lib/money.ts`.

**Tech Stack:** As Phase 4. No new dependencies: HMAC-SHA512 comes from `node:crypto`, Paystack calls use `fetch` through the existing thin client.

**Spec:** `docs/superpowers/specs/2026-10-31-agrohub-design.md` sections 2 (money held safely and paid automatically; no cooperative can hold or redirect money; terms never change after agreement), 5.2, 6.5 (threads tied to a lot or order), 6.6, 6.7, 6.8, 6.11 (event emails: deferred, see Decisions), 6.14 (delivery schedule), 7, 13 (order edge cases, money edge cases, operations), 14 (bank change wait, account safety, scheduled jobs). Roadmap: `2026-10-31-agrohub-roadmap.md` Phase 5 (5.1 to 5.11) and Review Focus 1, 2 and 5. Architecture: `docs/architecture.md` sections 3, 5 (Order, Payment, PaystackEvent, LedgerEntry, Payout, Refund, StockReservation), 6 (Order state machine), 7 (money flow and invariants), 8. Paystack's written answer (4 Nov 2026): AgroHub keeps buyers' payments in its own Paystack balance and pays recipients by Transfers ("Manual Payouts"); transfers up to ₦10,000,000 each; refunds before release come from the held balance.

## Two pull requests (recommended)

Phase 5 is about twice Phase 4. It is planned here once, built in two parts, each its own PR to `main`, each runnable on its own:

- **Part A, PR "Phase 5a: orders, checkout and payment held"** (Tasks 1 to 8): order model and state machine, delivery quotes, checkout with reservation, Paystack initialize, verify and refund, the webhook, payments, ledger, automatic refund of a payment that came too late, order screens, the unpaid-order expiry job. **Done when** a buyer pays in Paystack test mode and the order reads "Paid, held until delivery is confirmed", and `duplicate_webhook_creates_one_payment` and `concurrent_last_unit_refunds_later_payment` pass.
- **Part B, PR "Phase 5b: delivery, release, payouts, refunds and disputes"** (Tasks 9 to 17): delivery schedule and marking, shortfall, buyer confirmation, auto-release and timeout, payouts and the transfer gateway, failed payouts and retry, cancellation, disputes, receipts and earnings statements, reconciliation, the invariant sweep and the full journey. **Done when** the roadmap's Phase 5 line holds: in test mode a buyer pays, the officer delivers, the buyer confirms, and cooperative and farmers are paid exactly once; `payout_reference_is_unique` and `payout_during_bank_change_wait_uses_old_account` pass.

Part B is cut from Part A's branch tip after Part A's PR is open (or merged), so it never waits on review. If you prefer one PR, the tasks run in the same order on one branch and the PR is titled "Phase 5: orders, payment hold, delivery and payouts".

## Before Task 1: local setup (no commit)

- Done already in this worktree: `npm ci`, `npx prisma generate`, databases `agrohub_p5_test` and `agrohub_p5_scratch`, untracked `.superpowers/vitest.p5.mts` and `.superpowers/playwright.p5.ts` (port 3100).
- Wherever a step says `npm test -- <files>`, run `npx vitest run --config .superpowers/vitest.p5.mts <files>`; the full suite likewise. Playwright: `npx playwright test --config .superpowers/playwright.p5.ts --workers=1`, never at the same time as the integration tests.
- Migrations: `DATABASE_URL=postgresql://agrohub:agrohub@localhost:5432/agrohub_p5_scratch npx prisma migrate dev --create-only --name <name>`, review the SQL, then `npx prisma generate`.

## Global Constraints

- Money is integer kobo; percentages are integer basis points. No floats. Arithmetic and formatting only in `src/lib/money.ts`. Order-level amounts are stored as Postgres `BIGINT` and cross the database boundary only through `koboFromDb` and `koboToDb`.
- The buyer pays the lot price plus any delivery cost. The AgroHub fee and the cooperative cut come out of the sale price, never on top. The cooperative keeps the delivery cost. Paystack's processing fee is absorbed by AgroHub, so a farmer's take-home is never reduced.
- Shares come from the terms locked on each lot (`LotFeeTerms`), apportioned to farmers by contribution quantity. Terms never change after an order is placed.
- An order is marked paid only after Paystack's signed webhook and a verification call that confirms status `success`, the exact amount in kobo and currency `NGN`. A browser return from Paystack never marks anything paid.
- Stock is reserved for 15 minutes when checkout starts; an accepted offer holds its quantity until its `payByAt`. Checkout takes only offers whose buyer status reads `ACCEPTED`. If two payments both succeed for the last stock, the later is refunded automatically.
- Auto-release 3 days after the officer marks delivery; an order with no delivery mark 14 days after payment goes to an admin. A report freezes the funds for an admin.
- Every payout has a unique reference and is never marked paid until Paystack confirms the transfer. A failed transfer stays failed, alerts an admin and is retried. Payouts wait for cleared funds. A payout released during a bank change's 48-hour wait goes to the old account (`effectiveRecipientCode(owner, releasedAt)`).
- Every payment, hold, release, refund and payout is written to the append-only ledger and the audit log. Per order the ledger sums to zero; payouts plus the platform fee equal the amount paid minus refunds.
- Payout instructions are created only by server code on the transition to `COMPLETED` (or an admin's release decision). No route or action takes a recipient or an amount from a client.
- Webhooks, payouts, refunds and jobs are safe to run twice. Never log secrets or full webhook bodies; Paystack test keys only in tests and staging.
- The floor is never shown to buyers; order views for buyers never carry floor, farmer identity or bank data. Officers never see farmers' or buyers' bank data or phone numbers.
- User-facing copy never says "escrow": say "payment held until delivery is confirmed". All strings in `messages/*.json`, keys mirrored in all five files.
- Business logic only in `src/modules/*/service.ts` (and files it re-exports); every service function takes an `Actor` and calls `can()` first (system functions called by the webhook or jobs carry a comment saying why they have none). A module imports another only through its `service.ts`.
- Before each commit: `npm run lint`, `npm run typecheck`, `npm test`. No Co-Authored-By or "Generated with" lines. Stage files explicitly.

## Review Focus

1. A Paystack transfer of more than ₦10,000,000: a large farmer or cooperative share is refused by Paystack and the payout fails forever. Shares above the limit are split into parts of at most ₦10,000,000, each its own payout with its own reference (Task 1 `splitTransferParts` table; Task 10 `large_share_is_split_into_transfer_parts`).
2. An order total above ₦21,474,836.47 (the 32-bit integer limit), which bulk orders reach: stored as `BIGINT`, and a ₦50,000,000 order goes through checkout, webhook, release and payouts with exact values (Task 1 `koboFromDb` table; Task 6 `fifty_million_naira_order_is_exact`).
3. A transfer Paystack accepts but holds (a first-payout verification hold, or OTP still switched on): the payout stays "sent, awaiting Paystack", is never retried while pending (no double pay) and never marked paid; after 3 days the reconciliation job shows it to admins (Task 11 `pending_transfer_is_never_retried`; Task 16 `stale_pending_transfer_is_flagged`).
4. A webhook whose amount, currency or reference does not match, or whose signature is wrong, or a forged "success" for a transaction Paystack's verify call says failed: nothing is marked paid and the event is kept for admins (Task 6 `bad_signature_is_401_and_records_nothing`, `verify_disagrees_order_stays_unpaid`, `amount_mismatch_is_not_paid`).
5. A farmer whose payout account is missing or who left the cooperative after the sale, or a cooperative suspended with paid orders: the payout is created `BLOCKED` (never skipped, never redirected to the cooperative), and the order shows in the admin queue (Task 10 `farmer_without_recipient_is_blocked_not_skipped`; Task 14 `suspended_cooperative_orders_reach_admin_queue`).

## Decisions this plan makes

Made by this plan (the spec is silent or leaves it open; each is flagged in the PR under "Choices to check"):

**Orders and checkout**
- **One lot per order.** An order is one lot, one quantity, one unit price; the `OrderLine` table in the architecture is folded into `Order` (lot, quantity, unit price and the locked terms copied at checkout). A basket of lots is several orders.
- **Two ways in:** "Buy now" on a live lot at the asking price (quantity from the minimum order to what is available), or "Pay" on an offer whose buyer status is `ACCEPTED`, at its agreed price and quantity.
- **Every checkout creates a new `PENDING_PAYMENT` order** with one `Payment` (our reference `pay_<cuid>`), a 15-minute `StockReservation`, and a Paystack transaction initialized for the total. Paystack's checkout page is opened by redirect; channels card, bank transfer and USSD.
- **Stock is computed, never decremented:** `committedQuantity = sold (orders paid and not cancelled, refunded or delivered short) + live reservations of other checkouts + accepted offers still inside payByAt with no paid order`. A checkout from an accepted offer reserves nothing extra (the offer already holds it). When paid stock reaches the lot's quantity the lot becomes `SOLD_OUT`; a refund before delivery returns it to `LIVE` if its available-until date has not passed. A lot revision cannot lower the quantity below what is sold or committed (`QUANTITY_BELOW_COMMITTED`).
- **An unpaid order expires**: after its 15 minutes the reservation stops counting at once (on read); the daily `order-expiry` job marks `PENDING_PAYMENT` orders older than 24 hours `CANCELLED` (`PAYMENT_EXPIRED`). A payment that still succeeds later is handled like any other: accepted if the stock is still free, otherwise refunded in full automatically.
- **Offers gain `ORDERED`:** when an offer's order is paid the offer becomes `ORDERED` (buyers read "Paid"); it no longer holds stock because the order does.
- **Delivery cost is a structured quote, shown in the thread:** the officer quotes a delivery cost for a buyer on a lot (amount, optional note, valid 48 hours); it appears in the buyer's lot thread as a message "Delivery quote: ₦X, valid until …" and as a choice at checkout ("Pickup at <state, LGA>" or "Delivery, ₦X"). An unused quote expires; one quote is used by at most one order.
- **The order thread is the buyer's lot thread with the cooperative.** No new thread kind: the order page shows that thread, and delivery dates, delivery marks and confirmations are posted into it as AgroHub lines (side `ADMIN`, author "AgroHub"), so admins deciding a dispute read one thread. Opening it from an order works even when the lot is no longer on sale.

**Payments and refunds**
- **The webhook is the only way to "paid".** `POST /api/paystack/webhook` checks `x-paystack-signature` (HMAC-SHA512 of the raw body with `PAYSTACK_SECRET_KEY`, timing-safe), records a `PaystackEvent` once (key `<event>:<data.id>`, payload trimmed to event, reference, status, amount, currency; no customer, card or bank data), verifies with Paystack and applies, then answers 200 (work after the response is not reliable on Vercel). If Paystack's verify call is unavailable the event is marked `RETRY` and the route answers 500, so Paystack redelivers and the redelivery is processed; reconciliation catches anything left. The buyer's return page only says "We're confirming your payment".
- **Handled events:** `charge.success`, `transfer.success`, `transfer.failed`, `transfer.reversed`, `refund.processed`, `refund.failed`. Others are recorded and ignored.
- **Paystack's processing fee is read from the verify response (`fees`) and booked to AgroHub's side of the ledger**, never to a farmer or the cooperative.
- **Refunds use Paystack's refund API with our own `Refund` row first** (unique per order and purpose), so a retried refund never sends twice; a refund that times out is checked by reconciliation before anyone retries it.

**Delivery and release**
- **Order steps:** `PAID_HELD` → officer "Start preparing" (`PREPARING`) → officer marks delivered with the quantity delivered (`DELIVERED_MARKED`) → buyer confirms (`COMPLETED`). The officer proposes a delivery or pickup date at any point after payment (stored on the order, posted to the thread); the buyer asks for another in the thread.
- **Shortfall:** delivered quantity below ordered makes the buyer confirm the lower quantity or report a problem. On confirmation the unmet units are refunded at the unit price; cut, fee and farmer shares are recomputed on the delivered quantity, so each farmer's share shrinks in proportion. The delivery cost is not refunded on a shortfall. Undelivered units do not return to the lot.
- **Auto-release and timeout run in the daily job `order-timers` (05:30 UTC)**, because Vercel Hobby allows only daily crons: an order releases on the first run at least 3 days (72 hours) after the delivery mark, so up to a day late; an order paid 14 days ago with no delivery mark becomes `TIMED_OUT` for an admin. Every buyer action refuses a frozen or timed-out order.
- **Admin decisions on a disputed or timed-out order:** release in full; refund in full; or refund a number of units (the same arithmetic as a shortfall) and release the rest. Admins write a reason; every decision is audited.
- **Loss after release is out of scope** (spec 12, legal): once `COMPLETED`, no button moves money back. A buyer's report after completion goes to the admin queue as a note with no money action.

**Payouts**
- **Payouts are created on `COMPLETED`, in the same transaction**: one per recipient (the cooperative: its cut plus the delivery cost; each contributing farmer: their share), each split into parts of at most ₦10,000,000. Reference `po_<orderId>_<C|F>_<recipientId>_<part>`, unique in the database.
- **The account is fixed at release:** `effectiveRecipientCode(owner, completedAt)` is stored on the payout. A retry uses the stored account; an admin may re-point a failed payout to the owner's current effective account (audited).
- **Payouts wait for cleared funds**: a payout is sendable 24 hours after its order's payment was confirmed (Nigerian settlements are next-day) and is sent at once on release if already past that, else by the daily `payouts` job (06:30 UTC). If Paystack refuses for insufficient balance the payout stays `QUEUED` and is tried again the next day; after 3 refusals admins are alerted.
- **Payout states:** `QUEUED → SENT → PAID`, `SENT → FAILED → (retry) SENT`, `BLOCKED` (no account) → `QUEUED` once an admin fixes it. Each send is a `PayoutAttempt` with its own unique transfer reference (`<payout reference>-<n>`); a new attempt is allowed only after Paystack has confirmed the last one failed or reversed. A transfer answered `pending` or `otp` stays `SENT` (shown to admins as "awaiting Paystack").
- **Single transfers, not bulk:** one Paystack transfer per payout part. Bulk transfers (up to 100 per request) can come later behind the same gateway interface.

**Admins, alerts and emails**
- **One admin order queue** at `/admin/orders`: disputes, timed-out orders, paid orders of suspended cooperatives, blocked and failed payouts, transfers awaiting Paystack for over 3 days, and reconciliation mismatches, oldest first.
- **Admin alert emails now; event emails in Phase 8.** Payout failures, blocked payouts and reconciliation mismatches email every active admin now (operations, spec 13: "alerts on payment failures from day one"), like the existing bank-change alert. The buyer, officer and farmer event emails of spec 6.11 (order paid, delivery date set, delivery marked, payout sent, dispute opened or resolved) stay in Phase 8, as Phases 3 and 4 left theirs.
- **Reconciliation (`reconciliation`, daily 07:00 UTC):** compares the last 3 days of successful Paystack transactions with `Payment` rows, verifies every `SENT` attempt older than one hour and every pending refund, and records each mismatch as a `ReconciliationIssue` for the admin queue.
- **Receipts and earnings statements are pages**, printable from the browser: `/buyer/orders/[id]/receipt` and `/farmer/earnings/[orderId]`. No PDF generation.
- **The ledger is append-only like the audit log**: a trigger refuses `UPDATE`, `DELETE` and `TRUNCATE`, it has no foreign keys, and tests scope its rows by `orderId`.

---

## Part A: orders, checkout and payment held

### Task 1: Order money

**Files:**
- Modify: `src/lib/money.ts`
- Test: `tests/unit/order-money.test.ts`

**Interfaces:**
- Produces:
  - `type OrderSplit = { goodsKobo: number; deliveryKobo: number; totalKobo: number; cutKobo: number; feeKobo: number; cooperativePayoutKobo: number; farmerKobo: number[] }`.
  - `orderSplit(input: { unitKobo: number; quantity: number; cutBps: number; feeBps: number; deliveryKobo: number; contributions: number[] }): OrderSplit`: goods = `lineTotalKobo(unit, quantity)`; cut and fee by `applyBps` on goods (rounded down); farmers' total = goods − cut − fee, split by `splitByWeights` over `contributions`; cooperative payout = cut + delivery; total = goods + delivery. `RangeError` on an empty contributions list.
  - `refundForUnits(unitKobo: number, units: number): number` (= `lineTotalKobo`).
  - `splitTransferParts(kobo: number, maxKobo: number = MAX_TRANSFER_KOBO): number[]` with `MAX_TRANSFER_KOBO = 1_000_000_000` (₦10,000,000): equal-as-possible parts each ≤ max, summing to `kobo`; `[]` for 0.
  - `koboFromDb(value: bigint): number` (`RangeError` beyond safe) and `koboToDb(kobo: number): bigint` (non-negative safe integers only).

- [ ] **Step 1: Write the failing tests** (`order-money.test.ts`), tables of exact values:

  | unit | qty | cut | fee | delivery | contributions | goods | cut | fee | farmers | coop payout | total |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | 6,500,000 | 30 | 500 | 300 | 2,500,000 | [30] | 195,000,000 | 9,750,000 | 5,850,000 | [179,400,000] | 12,250,000 | 197,500,000 |
  | 6,500,000 | 25 | 500 | 300 | 2,500,000 | [30] | 162,500,000 | 8,125,000 | 4,875,000 | [149,500,000] | 10,625,000 | 165,000,000 |
  | 33,333 | 7 | 250 | 300 | 0 | [3, 4] | 233,331 | 5,833 | 6,999 | [94,500, 125,999] | 5,833 | 233,331 |
  | 50,000,000 | 100 | 0 | 300 | 0 | [100] | 5,000,000,000 | 0 | 150,000,000 | [4,850,000,000] | 0 | 5,000,000,000 |

  For every row, `cooperativePayoutKobo + feeKobo + sum(farmerKobo) === totalKobo`; a fast-check property asserts the same for random inputs. `refundForUnits(6500000, 5) === 32500000`, and row 2 total = row 1 total − 32,500,000. `splitTransferParts(4850000000)` → `[970000000 × 5]`; `splitTransferParts(1000000001)` → `[500000001, 500000000]`; `splitTransferParts(1000000000)` → `[1000000000]`; `splitTransferParts(0)` → `[]`; every part ≤ max and parts sum to the input (property). `koboFromDb(5000000000n) === 5000000000`; `koboFromDb(2n ** 60n)` throws `RangeError`; `koboToDb(-1)` throws.
- [ ] **Step 2: Run** `npm test -- tests/unit/order-money.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the five functions in `money.ts` (BigInt intermediates as elsewhere in the file).
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: order split, transfer parts and BIGINT kobo helpers` (body: transfers capped at ₦10,000,000 per part; order amounts stored as BIGINT).

### Task 2: Order schema and state machine

**Files:**
- Modify: `prisma/schema.prisma`, `tests/integration/helpers.ts` (`cleanDatabase` deletes, before `message`: `refund`, `payment`, `stockReservation`, `deliveryQuote`, `order`, `paystackEvent`; ledger rows are never deleted)
- Create: migration `orders_payments`, `src/modules/orders/state.ts`
- Test: `tests/unit/order-state.test.ts`

**Interfaces:**
- Produces:
  - `enum OrderStatus { PENDING_PAYMENT PAID_HELD PREPARING DELIVERED_MARKED COMPLETED CANCELLED REFUNDED DISPUTED TIMED_OUT }`; `enum DeliveryMethod { PICKUP DELIVERY }`; `enum PaymentStatus { INITIALIZED SUCCEEDED FAILED }`; `enum RefundStatus { PENDING PROCESSED FAILED }`; `enum RefundReason { LATE_PAYMENT BUYER_CANCEL COOPERATIVE_CANCEL SHORTFALL ADMIN_DECISION }`; `enum LedgerAccount { PAYSTACK_BALANCE HELD COOPERATIVE_PAYABLE FARMER_PAYABLE PLATFORM_FEE PAYSTACK_FEES REFUND_PAYABLE }`; `OfferStatus` gains `ORDERED`.
  - `model Order { id, lotId, cooperativeId, buyerUserId, offerId String?, quantity Int, unitKobo Int, cutBps Int, feeBps Int, deliveryMethod, deliveryKobo BigInt @default(0), deliveryQuoteId String? @unique, totalKobo BigInt, status OrderStatus @default(PENDING_PAYMENT), cancelReason String?, paidAt DateTime?, preparingAt DateTime?, deliveryDate DateTime? @db.Date, deliveredQuantity Int?, deliveredMarkedAt DateTime?, completedAt DateTime?, timedOutAt DateTime?, createdAt, updatedAt; @@index([lotId, status]); @@index([cooperativeId, status]); @@index([buyerUserId, createdAt]); @@index([status, paidAt]); @@index([status, deliveredMarkedAt]); @@index([offerId]) }` (`@@map("order")`).
  - `model StockReservation { id, lotId, orderId @unique, quantity Int, countsTowardStock Boolean, expiresAt DateTime, createdAt; @@index([lotId, expiresAt]) }` (`countsTowardStock` false for checkouts from an accepted offer).
  - `model Payment { id, orderId, reference String @unique, amountKobo BigInt, status PaymentStatus @default(INITIALIZED), paystackTransactionId String? @unique, feesKobo BigInt?, channel String?, confirmedAt DateTime?, createdAt; @@index([orderId]) }`.
  - `model PaystackEvent { id, eventKey String @unique, event String, reference String?, payload Json, outcome String?, receivedAt DateTime @default(now()) }`.
  - `model LedgerEntry { id, orderId String, groupId String, kind String, account LedgerAccount, recipientRef String?, amountKobo BigInt, createdAt; @@index([orderId]); @@index([groupId]) }`: no foreign keys; positive is a debit; the migration adds `ledger_entry_reject_mutation()` and triggers refusing `UPDATE`, `DELETE` and `TRUNCATE`, copied from the `audit_log` migration.
  - `model Refund { id, orderId, purpose String (unique with orderId: "late", "cancel", "shortfall", "dispute"), reason RefundReason, amountKobo BigInt, status RefundStatus @default(PENDING), paystackRefundId String? @unique, requestedByUserId String?, processedAt DateTime?, createdAt; @@unique([orderId, purpose]) }`.
  - `model DeliveryQuote { id, lotId, cooperativeId, buyerUserId, amountKobo BigInt, note String?, quotedByUserId, expiresAt DateTime, createdAt; @@index([lotId, buyerUserId]) }`.
  - `state.ts` (pure): `ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]>`:
    `PENDING_PAYMENT → [PAID_HELD, CANCELLED, REFUNDED]`; `CANCELLED → [PAID_HELD, REFUNDED]` (only a late payment, see Decisions); `PAID_HELD → [PREPARING, DELIVERED_MARKED, REFUNDED, DISPUTED, TIMED_OUT]`; `PREPARING → [DELIVERED_MARKED, REFUNDED, DISPUTED, TIMED_OUT]`; `DELIVERED_MARKED → [COMPLETED, DISPUTED]`; `DISPUTED → [COMPLETED, REFUNDED]`; `TIMED_OUT → [COMPLETED, REFUNDED, DELIVERED_MARKED]`; `COMPLETED → []`; `REFUNDED → []`.
    `canTransition(from: OrderStatus, to: OrderStatus): boolean`; `assertTransition(from, to): void` (`ConflictError` `ORDER_STATE` naming neither amount nor party); `isOpenOrder(status: OrderStatus): boolean` (`PAID_HELD`, `PREPARING`, `DELIVERED_MARKED`, `DISPUTED`, `TIMED_OUT`); `isFrozen(status)` (`DISPUTED`, `TIMED_OUT`).

- [ ] **Step 1: Write the failing test** `order-state.test.ts`: every pair of the 9 × 9 statuses against the table above (81 rows, generated from an explicit expected list, not from `ORDER_TRANSITIONS`); `assertTransition("COMPLETED", "REFUNDED")` throws `ORDER_STATE`; `isOpenOrder` true for exactly the five listed.
- [ ] **Step 2: Run** `npm test -- tests/unit/order-state.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema, the migration (`--create-only --name orders_payments`; add the ledger triggers by hand; check it has no `DROP`), `npx prisma generate`, `state.ts`, `cleanDatabase`.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: order, payment, ledger and refund schema; order state machine` (body: one lot per order; ledger append-only by trigger, no foreign keys).

### Task 3: Paystack transactions, refunds and webhook signatures

**Files:**
- Modify: `src/lib/paystack.ts`, `src/app/api/dev/paystack/` (keep `accounts`)
- Test: `tests/unit/paystack.test.ts`

**Interfaces:**
- Produces (each with a `*With(config, …)` form like `createRecipientWith`; amounts are integer kobo `number`):
  - `initializeTransaction(input: { email: string; amountKobo: number; reference: string; callbackUrl: string; metadata: { orderId: string } }): Promise<{ authorizationUrl: string; accessCode: string }>` → `POST /transaction/initialize` with `currency: "NGN"`, `channels: ["card", "bank_transfer", "ussd"]`.
  - `verifyTransaction(reference: string): Promise<{ status: "success" | "failed" | "abandoned" | "pending" | "reversed" | string; amountKobo: number; currency: string; transactionId: string; feesKobo: number; channel: string | null; paidAt: string | null }>` → `GET /transaction/verify/:reference`.
  - `refundTransaction(input: { reference: string; amountKobo: number }): Promise<{ refundId: string; status: string }>` → `POST /refund` (`transaction`, `amount`).
  - `listTransactions(input: { from: Date; to: Date; status: "success" }): Promise<Array<{ reference: string; amountKobo: number; transactionId: string }>>` (paged, at most 20 pages of 100).
  - `verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean` (HMAC-SHA512 hex, `timingSafeEqual`, false on missing or wrong length).
  - `webhookSecret(): string`: `PAYSTACK_SECRET_KEY`, or `FAKE_WEBHOOK_SECRET = "sk_test_fake_webhook"` when `selectPaystack` is `"fake"`.
  - Fake: `fakePaystack` gains `transactions: Map<reference, { amountKobo; email; status; transactionId; feesKobo }>`, `refunds: Array<{ reference; amountKobo; refundId }>`, `failNextRefund: boolean`, cleared by `clear()`. Fake initialize returns `authorizationUrl = /dev/paystack/checkout?reference=<ref>`; `fakeSettle(reference, outcome: "success" | "failed", amountKobo?)` sets the transaction and returns the signed webhook body and signature, for tests and the dev page.
  - The existing error mapping stays: 5xx and 429 → `UnavailableError` `PAYSTACK_UNAVAILABLE`; for these endpoints a 400 is `ConflictError` `PAYSTACK_REFUSED` with Paystack's `message` kept only when it matches a short allow-list ("insufficient balance", "already refunded", "transaction not found").

- [ ] **Step 1: Write the failing tests** in `paystack.test.ts`, with a stubbed `fetch` as the file already does: initialize posts amount `197500000` as a number, `currency: "NGN"`, the three channels and our reference, and returns the URL; verify maps `amount`, `fees`, `currency`, `id`; a 500 → `PAYSTACK_UNAVAILABLE`; refund posts `transaction` and `amount`; `verifyWebhookSignature` is true for the HMAC of a known body and key (fixed vector computed in the test with `createHmac`), false for one changed byte, for `null`, and for a shorter signature; no `console.error` call ever contains the request body, the email or the key (spy). Fake: initialize then `fakeSettle(ref, "success")` → `verifyTransaction(ref).status === "success"` and the returned signature verifies against `webhookSecret()`.
- [ ] **Step 2: Run** `npm test -- tests/unit/paystack.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the client functions and the fake. Extend `call()` to take a JSON body of numbers and nested objects.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Paystack transactions, refunds and webhook signature check`.

### Task 4: Committed stock, delivery quotes and the order guards

**Files:**
- Modify: `src/modules/marketplace/limits.ts` (remove `heldQuantity`), `src/modules/marketplace/offers.ts`, `src/modules/marketplace/negotiation.ts`, `src/modules/marketplace/views.ts` (`BuyerOfferStatus` gains `"ORDERED"`), `src/modules/catalog/service.ts`, `src/modules/catalog/revisions.ts`, `src/modules/catalog/orders-guard.ts`, `src/modules/farmers/orders-guard.ts`, `src/modules/messaging/service.ts`, `src/modules/identity/policies.ts`, `tests/access/policy-matrix.test.ts`, `src/components/offers/status.ts`, `messages/*.json`
- Create: `src/modules/catalog/stock.ts`, `src/modules/orders/quotes.ts`, `src/modules/orders/service.ts`
- Test: `tests/integration/stock.test.ts`, `tests/integration/delivery-quotes.test.ts`

**Interfaces:**
- Consumes: Task 2 models; `lockLot`, `isPubliclyVisible`.
- Produces:
  - `committedQuantity(tx: Prisma.TransactionClient, lotId: string, now: Date, exclude?: { orderId?: string; offerId?: string }): Promise<number>` in `catalog/stock.ts`, re-exported from `catalog/service.ts`: sold (orders in `PAID_HELD, PREPARING, DELIVERED_MARKED, COMPLETED, DISPUTED, TIMED_OUT`, counting `deliveredQuantity` once it is set) + reservations with `expiresAt > now`, `countsTowardStock` and their order still `PENDING_PAYMENT` + `ACCEPTED` offers with `payByAt > now`. Every Phase 4 caller of `heldQuantity` uses it.
  - `availableQuantity(lotId: string, now: Date): Promise<number>` (public read, no Actor; lot quantity − committed, never negative), used by the lot page.
  - `hasOpenOrders(lotId)`: any order on the lot with `isOpenOrder`, or `PENDING_PAYMENT` with a live reservation. `hasUnfinishedOrders(farmerUserId)`: any open order on a lot the farmer contributes to (Part B adds: or a `COMPLETED` order with a farmer payout to them not `PAID`).
  - Lot revisions: approving a quantity below `committedQuantity` → `ConflictError` `QUANTITY_BELOW_COMMITTED`.
  - Actions: `"order:checkout"`: BUYER; `"order:own"`: BUYER and `ownerUserId === actor.userId`; `"order:manage"`: OFFICER with own cooperative; `"order:admin"`: ADMIN; `"quote:make"`: OFFICER with own cooperative; `"earnings:own"`: FARMER and `ownerUserId === actor.userId`.
  - `quoteDelivery(actor, input: { lotId: string; buyerUserId: string; amountKobo: number; note?: string }, now = new Date()): Promise<{ quoteId: string }>`: `quote:make`; the buyer has a buyer thread on this lot (`NO_BUYER_THREAD`); amount 1 kobo to ₦10,000,000 (`QUOTE_RANGE`); note through the message guards; `expiresAt = now + 48 h`; posts "Delivery quote: ₦X, valid until <Lagos time>" (and the note) to the buyer's lot thread as the cooperative; audit `quote.make` `{ quoteId, lotId, amountKobo }`.
  - `listUsableQuotes(actor, lotId, now = new Date()): Promise<Array<{ id: string; amountKobo: number; note: string | null; expiresAt: string }>>`: BUYER, own quotes on the lot, unexpired and not used by an order.
  - `openOrderThread` support: `ensureBuyerThread(lotId, buyerUserId)` exported from `messaging/service.ts` as a system function (comment: called only by order services after their own `can()`), with no visibility check; `postSystemMessage(threadId, body)` posts side `ADMIN`.

- [ ] **Step 1: Write the failing tests.**
  - `stock.test.ts` (lot of 30): an accepted offer of 12 commits 12; a live reservation of 10 commits 10 more; an expired reservation commits nothing; a reservation tied to an accepted offer (`countsTowardStock` false) adds nothing; a `PAID_HELD` order of 8 commits 8, and once `deliveredQuantity` is 6 commits 6; a `REFUNDED` or `CANCELLED` order commits nothing; `makeOffer` for 19 on a lot with 12 committed → `NOT_ENOUGH_STOCK` (Phase 4 behaviour kept through the new function); `hasOpenOrders` false with only a `COMPLETED` order and true with a `DISPUTED` one; withdrawing a lot with a `PAID_HELD` order → the existing `LOT_HAS_OPEN_ORDERS`; a farmer with an open order on their lot cannot leave; a revision to quantity 10 with 12 committed → `QUANTITY_BELOW_COMMITTED`.
  - `delivery-quotes.test.ts`: the officer quotes ₦25,000 to a buyer who opened a thread → the thread shows "Delivery quote: ₦25,000.00" as the cooperative; `listUsableQuotes` returns it for that buyer and nothing for another buyer; after 49 hours it is gone; a quote to a buyer with no thread → `NO_BUYER_THREAD`; an officer of another cooperative → `ForbiddenError`; a note "call 08031234567" → `MESSAGE_HAS_CONTACT` and no quote.
  - Matrix rows for the six new actions.
- [ ] **Step 2: Run** `npm test -- tests/integration/stock.test.ts tests/integration/delivery-quotes.test.ts tests/access/policy-matrix.test.ts tests/integration/offers.test.ts tests/integration/negotiation.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `stock.ts`, the guards, the policy rules, `quotes.ts` and the messaging helpers; swap every `heldQuantity` call.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: committed stock across offers, reservations and orders; delivery quotes in the thread` (body: stock computed, never decremented; order thread is the buyer's lot thread).

### Task 5: Checkout with a 15-minute reservation

**Files:**
- Create: `src/modules/orders/checkout.ts`, `src/modules/orders/schema.ts`, `src/modules/orders/views.ts`
- Modify: `src/modules/orders/service.ts`, `src/modules/marketplace/service.ts` (export `checkoutFacts` for an offer)
- Test: `tests/integration/checkout.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4; `buyerStatusOf`; `initializeTransaction`; `effectiveCutBps` is not used (terms come from `LotFeeTerms`).
- Produces:
  - `RESERVATION_MINUTES = 15`, `UNPAID_ORDER_HOURS = 24` in `orders/checkout.ts`.
  - `startCheckoutInput` zod: `{ source: "LOT"; lotId; quantity: int ≥ 1 } | { source: "OFFER"; offerId }`, plus `deliveryQuoteId?: string`.
  - `startCheckout(actor, input, now = new Date()): Promise<{ orderId: string; authorizationUrl: string }>`: `can(actor, "order:checkout")`; not the buyer's own cooperative (`OWN_COOPERATIVE_LOT`); for `OFFER`: `order:own` on the offer (else `OFFER_NOT_FOUND`) and its buyer status is `ACCEPTED` (`OFFER_NOT_PAYABLE`), quantity and unit price from the offer; for `LOT`: unit price is the ask, quantity ≥ minimum order (`BELOW_MIN_ORDER`); lot publicly visible (`LOT_NOT_AVAILABLE`); the lot has `LotFeeTerms` (`LOT_TERMS_MISSING`); quote, when given, usable by this buyer on this lot (`QUOTE_NOT_USABLE`). In one transaction after `lockLot`: `quantity ≤ lot quantity − committedQuantity(…, { offerId })` (`NOT_ENOUGH_STOCK`); create the `Order` (terms copied from `LotFeeTerms`, `totalKobo` from `orderSplit`), the `StockReservation` (`expiresAt = now + 15 min`, `countsTowardStock = source === "LOT"`), the `Payment` (`pay_<cuid>`, `INITIALIZED`); audit `order.checkout` `{ orderId, lotId, quantity, unitKobo, totalKobo }` (as strings for BIGINT). After commit: `initializeTransaction` with the buyer's email, `callbackUrl = <BETTER_AUTH_URL>/buyer/orders/<id>`; if Paystack fails, the order is set `CANCELLED` (`PAYSTACK_UNAVAILABLE`), the reservation released, and the `UnavailableError` rethrown.
  - `BuyerOrder = { id; reference: string (last 8 of id, upper case); lot: { id; crop; unit; cooperativeName }; quantity; deliveredQuantity: number | null; unitKobo; goodsKobo; deliveryMethod; deliveryKobo; totalKobo; refundedKobo; status: BuyerOrderStatus; reservedUntil: string | null; deliveryDate: string | null; createdAt; paidAt: string | null; threadId: string | null }` via `toBuyerOrder`, field by field, `BuyerOrderStatus = "AWAITING_PAYMENT" | "PAYMENT_EXPIRED" | "PAID_HELD" | "PREPARING" | "DELIVERED" | "COMPLETED" | "CANCELLED" | "REFUNDED" | "UNDER_REVIEW"` (`DISPUTED` and `TIMED_OUT` both read `UNDER_REVIEW`). No farmer identity, no floor, no bank data.

- [ ] **Step 1: Write the failing tests** (`checkout.test.ts`; lot of 30 at ₦65,000, min order 5, cut 5%, fee 3%):
  - buy 10 now → order `PENDING_PAYMENT`, total 65,000,000 kobo, a reservation expiring in 15 minutes, a fake Paystack transaction for 65,000,000 with our reference, one `order.checkout` audit row; `availableQuantity` is 20;
  - with a ₦25,000 delivery quote → total 67,500,000 and the quote is marked used; the same quote on a second checkout → `QUOTE_NOT_USABLE`;
  - `reservation_blocks_other_buyers`: buyer A reserves 25 of 30; buyer B's checkout for 10 → `NOT_ENOUGH_STOCK`; at +16 minutes B's checkout for 10 succeeds;
  - `concurrent_checkouts_never_oversell`: three buyers check out 12 each at once (`Promise.allSettled`) → exactly two fulfilled;
  - from an accepted offer of 12 at ₦60,000 → total 72,000,000 and committed quantity stays 12 (not 24); from an offer that reads `EXPIRED` (past `payByAt`, or lot withdrawn) → `OFFER_NOT_PAYABLE`; another buyer's offer → `OFFER_NOT_FOUND`;
  - 4 units → `BELOW_MIN_ORDER`; an officer of the lot's cooperative who is also a buyer → `OWN_COOPERATIVE_LOT`; a FARMER actor → `ForbiddenError`;
  - Paystack unavailable (fake set to fail) → `PAYSTACK_UNAVAILABLE`, the order `CANCELLED`, and stock free again;
  - `JSON.stringify(toBuyerOrder(…))` contains neither the floor's kobo nor the farmer's id or name.
- [ ] **Step 2: Run** `npm test -- tests/integration/checkout.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `checkout.ts`, the schema and the buyer view.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: checkout reserves stock for 15 minutes and starts a Paystack payment` (body: lot at the asking price or an accepted offer; Paystack failure cancels the order).

### Task 6: Webhook, payment confirmation, ledger and the late-payment refund

**Files:**
- Create: `src/app/api/paystack/webhook/route.ts`, `src/modules/payments/service.ts`, `src/modules/payments/payments.ts`, `src/modules/payments/ledger.ts`, `src/modules/payments/refunds.ts`, `src/modules/payments/webhook-schema.ts`
- Modify: `src/modules/orders/service.ts`, `src/modules/marketplace/service.ts` (mark an offer `ORDERED`)
- Test: `tests/integration/webhook.test.ts`, `tests/integration/ledger.test.ts`, `tests/integration/payments.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5.
- Produces:
  - `ledger.ts`: `postLedger(tx, input: { orderId: string; kind: LedgerKind; lines: Array<{ account: LedgerAccount; amountKobo: number; recipientRef?: string }> }): Promise<string>` (returns the `groupId`; `Error("LEDGER_UNBALANCED")` unless the lines sum to 0; no line of 0). `LedgerKind = "payment.captured" | "paystack.fee" | "refund.issued" | "refund.processed" | "order.released" | "payout.paid"`. Lines per kind, positive = debit:
    - `payment.captured`: `PAYSTACK_BALANCE +T`, `HELD −T`;
    - `paystack.fee`: `PAYSTACK_FEES +f`, `PAYSTACK_BALANCE −f`;
    - `refund.issued`: `HELD +R`, `REFUND_PAYABLE −R`; `refund.processed`: `REFUND_PAYABLE +R`, `PAYSTACK_BALANCE −R`;
    - `order.released` (Part B): `HELD +(T − R)`, `COOPERATIVE_PAYABLE −c`, `FARMER_PAYABLE −fᵢ` (recipientRef the farmer's user id), `PLATFORM_FEE −fee`;
    - `payout.paid` (Part B): `COOPERATIVE_PAYABLE` or `FARMER_PAYABLE +p`, `PAYSTACK_BALANCE −p`.
  - `ledgerBalance(orderId: string, account?: LedgerAccount): Promise<number>` (system read for tests, reconciliation and admin views).
  - `handlePaystackWebhook(rawBody: string, signature: string | null): Promise<{ status: 200 | 401 | 400 }>` (system function, no Actor: Paystack calls it; authenticated by the signature): bad signature → 401 and nothing stored; body that fails the zod schema → 400 and nothing stored; otherwise insert `PaystackEvent` with `outcome: "PROCESSING"` (duplicate key whose outcome is not `RETRY` → 200, nothing else happens; a `RETRY` row is claimed by a conditional update back to `PROCESSING`); dispatch by `event`; an `UnavailableError` sets `RETRY` and returns 500; otherwise store the outcome and return 200.
  - `confirmPayment(reference: string, now = new Date()): Promise<"PAID" | "REFUNDING" | "IGNORED">` (system function): load the `Payment` by reference (unknown → `IGNORED`, event outcome `UNKNOWN_REFERENCE`); `verifyTransaction`; unless `status === "success"`, `amountKobo` equals the payment's amount and `currency === "NGN"` → `IGNORED` with outcome `VERIFY_MISMATCH` (payment stays `INITIALIZED`). Then in one transaction after `lockLot` and a conditional update of the payment `INITIALIZED → SUCCEEDED` (count 0 → already done → `IGNORED`): write `payment.captured` and `paystack.fee` ledger groups; if `quantity ≤ lot quantity − committedQuantity(…, { orderId, offerId })` → order `PAID_HELD` (`assertTransition`), `paidAt`, reservation deleted, the offer `ORDERED`, the lot `SOLD_OUT` if nothing is left, audit `order.paid` `{ orderId, paymentId, totalKobo }`; else → order `REFUNDED` (`LATE_PAYMENT`), a `Refund` (`purpose "late"`, full amount) and `refund.issued`, audit `order.late_payment_refund`; after commit `issueRefund(refundId)`.
  - `issueRefund(refundId: string): Promise<void>` (system function): calls `refundTransaction` once per `Refund` without a `paystackRefundId` (claimed with a conditional update); stores the id; a Paystack error leaves it `PENDING` for reconciliation and audits `refund.call_failed` (no body). `refund.processed` webhook → `PROCESSED`, `processedAt`, `refund.processed` ledger group; `refund.failed` → `FAILED` and an admin alert (Task 11 email helper; until Part B, an audit row `refund.failed`).
  - Route: `POST` reads `await request.text()`, passes `x-paystack-signature`, returns the status with an empty JSON body; logs only the event name and outcome.

- [ ] **Step 1: Write the failing tests.**
  - `webhook.test.ts`: `bad_signature_is_401_and_records_nothing` (no `PaystackEvent`, order unchanged); a signed `charge.success` for a checkout → 200, order `PAID_HELD`, payment `SUCCEEDED`; `duplicate_webhook_creates_one_payment`: the same body delivered twice, then twice at once with `Promise.all` → one `PaystackEvent`, one `SUCCEEDED` payment, one `payment.captured` group, one `order.paid` audit row; `verify_disagrees_order_stays_unpaid`: signed `charge.success` but the fake transaction is `failed` → order `PENDING_PAYMENT`, outcome `VERIFY_MISMATCH`; `amount_mismatch_is_not_paid`: Paystack verifies 100 kobo less → not paid; an unknown reference → 200 and outcome `UNKNOWN_REFERENCE`; an unhandled event (`subscription.create`) → 200 and recorded; the stored payload has no `customer`, `authorization` or email field.
  - `payments.test.ts`: `concurrent_last_unit_refunds_later_payment`: buyer A checks out the last 10 units, A's reservation lapses (+16 min), buyer B checks out the same 10, both payments succeed, B's webhook first then A's → B `PAID_HELD`; A `REFUNDED` with one `Refund` (`LATE_PAYMENT`, 65,000,000 kobo) and one fake Paystack refund for A's reference; delivering A's webhook again adds no second refund; a late payment on a `CANCELLED` (`PAYMENT_EXPIRED`) order whose stock is still free → `PAID_HELD`; paying an accepted offer's order makes the offer `ORDERED` and the buyer's offer status `ORDERED`; paying the whole lot makes it `SOLD_OUT` and it disappears from `searchLiveLots`; `refund.processed` webhook → refund `PROCESSED`; `fifty_million_naira_order_is_exact`: a lot of 100 at ₦500,000 (cut 0) bought whole → total 5,000,000,000 kobo stored and read back exactly, ledger `HELD` = −5,000,000,000.
  - `ledger.test.ts`, table of ledger states after each event (T = 65,000,000, fee f = 200,000 from the fake): after payment `PAYSTACK_BALANCE 64,800,000`, `HELD −65,000,000`, `PAYSTACK_FEES 200,000`; after a full late refund issued and processed `HELD 0`, `REFUND_PAYABLE 0`, `PAYSTACK_BALANCE −200,000`; for every order in the file the sum of all its entries is 0; `postLedger` with lines summing to 1 throws `LEDGER_UNBALANCED`; an `UPDATE` or `DELETE` on `ledger_entry` by raw SQL throws.
- [ ] **Step 2: Run** `npm test -- tests/integration/webhook.test.ts tests/integration/payments.test.ts tests/integration/ledger.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the route, schema, ledger, confirmation and refunds.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Paystack webhook marks orders paid after verification; ledger; late payments refunded` (body: event key event:data.id; trimmed payloads; refunds idempotent per order and purpose).

### Task 7: Order screens, local test checkout and unpaid-order expiry

**Files:**
- Create: `src/modules/orders/job.ts`, `src/app/buyer/orders/page.tsx`, `src/app/buyer/orders/[id]/page.tsx`, `src/app/lots/[id]/checkout-form.tsx`, `src/app/buyer/offers/[id]/pay-button.tsx`, `src/app/buyer/orders/actions.ts`, `src/app/officer/orders/page.tsx`, `src/app/officer/orders/[id]/page.tsx`, `src/app/officer/quotes/actions.ts` (and a quote form on the officer's view of a buyer thread), `src/app/dev/paystack/checkout/page.tsx` (local only: `notFound()` unless `selectPaystack` is fake), `src/components/orders/status.ts`, `src/components/orders/error-key.ts`
- Modify: `src/modules/orders/service.ts`, `src/lib/jobs/index.ts`, `vercel.json`, `src/components/nav-links.ts`, `src/app/lots/[id]/page.tsx`, `src/app/buyer/page.tsx`, `messages/*.json`
- Test: `tests/integration/order-reads.test.ts`, `tests/integration/order-expiry.test.ts`, `tests/unit/order-ui.test.ts`, nav test

**Interfaces:**
- Consumes: Tasks 4 to 6.
- Produces:
  - `listOwnOrders(actor, now = new Date()): Promise<BuyerOrder[]>`, `getOwnOrder(actor, orderId, now = new Date()): Promise<BuyerOrder>` (`order:own`; else `ORDER_NOT_FOUND`).
  - `OfficerOrder = BuyerOrder` fields + `{ buyerName: string; status: OrderStatus; farmerShares: Array<{ farmerName: string; quantity: number; amountKobo: number }> }` via `toOfficerOrder` (no emails, phones or bank data); `listCooperativeOrders(actor, now)`, `getCooperativeOrder(actor, orderId, now)` (`order:manage`; else `ORDER_NOT_FOUND`).
  - `expireUnpaidOrders(now = new Date()): Promise<number>`: `PENDING_PAYMENT` orders created over 24 hours ago → `CANCELLED` (`PAYMENT_EXPIRED`) by conditional update, reservations deleted, audit `order.expire` each. Job `order-expiry`; `vercel.json` gains `{ "path": "/api/cron/order-expiry", "schedule": "45 4 * * *" }`.
  - Screens: on `/lots/[id]` an active buyer sees available quantity, "Buy now" (quantity, pickup or a usable delivery quote, the total, "Your payment is held until delivery is confirmed") → `startCheckoutAction` → redirect to Paystack; on `/buyer/offers/[id]` an `ACCEPTED` offer shows "Pay ₦X" with the same delivery choice. `/buyer/orders/[id]` shows status (`AWAITING_PAYMENT` with the reservation's end time and "We're confirming your payment" after a return from Paystack, a "Check again" link), amounts and the thread. `/officer/orders` lists paid orders by status and delivery date; `/officer/orders/[id]` shows the order and, in Part B, its actions. Officer thread pages for buyer threads gain "Quote delivery". Nav: BUYER gains `/buyer/orders` ("My orders"), OFFICER gains `/officer/orders` ("Orders").
  - Dev checkout page: shows the fake reference and amount with "Pay (test)" and "Payment fails (test)", which call `fakeSettle` and post the signed body to the webhook route, then redirect to the callback URL.
- [ ] **Step 1: Write the failing tests.** `order-reads.test.ts`: the buyer lists their orders newest first; another buyer → `ORDER_NOT_FOUND`; the officer of the cooperative sees `buyerName` and farmer shares (179,400,000 for the 30-bag row of Task 1), an officer of another cooperative → `ORDER_NOT_FOUND`; the buyer's order JSON has no `farmerShares`, floor or farmer name. `order-expiry.test.ts`: at +25 hours an unpaid order is `CANCELLED` (`PAYMENT_EXPIRED`) and the call returns 1; a second call returns 0; an order at +23 hours is untouched; a paid order is untouched; the cron route runs `order-expiry`. `order-ui.test.ts`: every `startCheckout` and `confirmPayment` error code maps through `orderErrorKey` to a key in `en.json`, all nine `BuyerOrderStatus` labels exist, and no `en.json` value contains "escrow" (case-insensitive). Nav includes `/buyer/orders` and `/officer/orders`.
- [ ] **Step 2: Run** `npm test -- tests/integration/order-reads.test.ts tests/integration/order-expiry.test.ts tests/unit/order-ui.test.ts tests/unit/header-nav.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the reads, views, job, cron entry, actions, pages and copy (controls at least 44 px; data read inside `<Suspense>`).
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: buyer checkout and order screens, officer orders, unpaid-order expiry job`.

### Task 8: Part A end to end, docs and PR

**Files:**
- Create: `tests/e2e/checkout.spec.ts`
- Modify: `tests/e2e/lot-world.ts`, `docs/architecture.md` (sections 5, 6, 7, 8: models as built, `ORDERED`, stock rule, webhook rule, jobs), `docs/environments.md` (Paystack webhook and staging protection, see "What you set up"), `docs/superpowers/plans/2026-10-31-agrohub-roadmap.md` (tick 5.1 to 5.4)
- Test: the e2e spec

- [ ] **Step 1: Write the failing test.** `checkout.spec.ts` (fake Paystack): a live lot of 30 bags; a buyer opens a thread and asks for delivery; the officer quotes ₦25,000; the buyer chooses "Delivery, ₦25,000.00", buys 10, lands on the dev checkout page, pays, returns, and the order reads "Paid, held until delivery is confirmed" with total ₦675,000.00; the lot page shows 20 available; the officer sees the order under "Orders" with the buyer's name. A second buyer makes an offer, the officer accepts, the buyer pays from the offer page and the offer reads "Paid". No page text contains "escrow". Warm `/buyer/orders` and `/officer/orders` first.
- [ ] **Step 2: Run** the spec with `--workers=1`. Expected: FAIL.
- [ ] **Step 3: Implement** helper changes and the doc edits.
- [ ] **Step 4: Run** the spec, the full Playwright suite, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `test: checkout and payment end to end; docs for Phase 5a`. Push with `git push -u origin phase-5-payments`, open PR "Phase 5a: orders, checkout and payment held" listing the Part A decisions under "Choices to check" and migration `orders_payments`.

---

## Part B: delivery, release, payouts, refunds and disputes

### Task 9: Delivery schedule, delivery marks and buyer confirmation

**Files:**
- Create: `src/modules/orders/delivery.ts`
- Modify: `prisma/schema.prisma` (none if Task 2's fields suffice), `src/modules/orders/service.ts`, `src/modules/orders/views.ts`
- Test: `tests/integration/delivery.test.ts`

**Interfaces:**
- Consumes: Task 2 `assertTransition`, Task 4 `postSystemMessage`.
- Produces:
  - `startPreparing(actor, orderId, now)`: `order:manage`; `PAID_HELD → PREPARING`; audit `order.preparing`.
  - `setDeliveryDate(actor, orderId, date: string /* YYYY-MM-DD, Lagos */, now)`: `order:manage`; status `PAID_HELD` or `PREPARING`; date today or later and at most 60 days on (`DELIVERY_DATE_RANGE`); posts "Delivery date proposed: <date>"; audit `order.delivery_date`.
  - `markDelivered(actor, orderId, deliveredQuantity: number, now)`: `order:manage`; `PAID_HELD` or `PREPARING` → `DELIVERED_MARKED`; `1 ≤ deliveredQuantity ≤ quantity` (`DELIVERED_RANGE`); posts "Marked delivered: N of M <unit>"; audit `order.delivered` `{ orderId, deliveredQuantity }`.
  - `confirmReceipt(actor, orderId, now)`: `order:own`; `DELIVERED_MARKED` only (`ORDER_STATE`); calls `completeOrder(orderId, "BUYER", now)` (Task 10). With a shortfall the screen says "N of M delivered: confirming refunds ₦X for the rest".
  - Officer screen `/officer/orders/[id]`: Start preparing, Propose a date, Mark delivered (quantity, defaulting to the ordered quantity). Buyer screen: delivery date, "Confirm I received it" and "Report a problem" (Task 14). Upcoming deliveries on `/officer/orders` sorted by date.
- [ ] **Step 1: Write the failing tests** (`delivery.test.ts`): prepare, propose a date, mark 30 of 30 → `DELIVERED_MARKED`, thread has the two AgroHub lines; mark 31 → `DELIVERED_RANGE`; marking a `PENDING_PAYMENT` order → `ORDER_STATE`; another cooperative's officer → `ORDER_NOT_FOUND`; the buyer cannot mark delivered (`ForbiddenError`); the buyer confirms → `COMPLETED`; confirming twice → `ORDER_STATE`; a date in the past → `DELIVERY_DATE_RANGE`.
- [ ] **Step 2: Run** `npm test -- tests/integration/delivery.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `delivery.ts`, the screens' actions and copy.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: delivery schedule, delivery marks with quantity, buyer confirmation`.

### Task 10: Release: completion, shortfall refund and payout creation

**Files:**
- Modify: `prisma/schema.prisma` (enums `PayoutStatus { QUEUED SENT PAID FAILED BLOCKED }`, `PayoutRecipient { COOPERATIVE FARMER }`, `AttemptStatus { SENT SUCCEEDED FAILED REVERSED }`; models `Payout { id, orderId, recipientType, recipientId (cooperative id or farmer user id), bankOwnerId (cooperative id or farmer profile id), part Int, amountKobo BigInt, recipientCode String?, reference String @unique, status @default(QUEUED), sendableAt DateTime, balanceRefusals Int @default(0), paidAt DateTime?, createdAt, updatedAt; @@unique([orderId, recipientType, recipientId, part]); @@index([status, sendableAt]) }`, `PayoutAttempt { id, payoutId, attempt Int, transferReference String @unique, transferCode String?, status AttemptStatus, failureReason String?, createdAt, settledAt DateTime?; @@unique([payoutId, attempt]) }`), `tests/integration/helpers.ts`, `src/modules/farmers/orders-guard.ts`
- Create: migration `payouts`, `src/modules/payments/payouts.ts`, `src/modules/orders/complete.ts`
- Test: `tests/integration/release.test.ts`

**Interfaces:**
- Consumes: Task 1 `orderSplit`, `splitTransferParts`; `effectiveRecipientCode` from `banking/service.ts`; Task 6 ledger and refunds.
- Produces:
  - `PAYOUT_CLEARING_HOURS = 24`.
  - `completeOrder(orderId: string, by: "BUYER" | "AUTO" | "ADMIN", now: Date, adminUnitsRefunded?: number): Promise<void>` (system function; callers check permissions): in one transaction with a conditional status update to `COMPLETED` (`assertTransition`): delivered units = `deliveredQuantity` minus `adminUnitsRefunded`; if fewer than ordered, a `Refund` (`purpose "shortfall"` or `"dispute"`, `refundForUnits`) and `refund.issued`; `orderSplit` on the delivered units with the order's copied terms and the lot's contributions; `order.released` ledger group; `createPayouts(tx, order, split, now)`; audit `order.completed` `{ orderId, by, deliveredQuantity, refundKobo }`. After commit: `issueRefund` and `sendDuePayouts({ orderId })`.
  - `createPayouts(tx, order, split, now)`: one row per recipient part; `recipientCode = effectiveRecipientCode(owner, now)`; null code (no account, or the farmer has no profile) → `BLOCKED` and an admin alert after commit; `sendableAt = max(now, paidAt + 24 h)`; reference `po_<orderId>_<C|F>_<recipientId>_<part>`; a zero amount creates no payout.
  - `hasUnfinishedOrders` also counts `COMPLETED` orders with a farmer payout to that farmer not `PAID`.
- [ ] **Step 1: Write the failing tests** (`release.test.ts`, the Task 1 row 1 order with one farmer):
  - confirmation → payouts: cooperative 12,250,000 and farmer 179,400,000, both `QUEUED`, `sendableAt` = `paidAt + 24 h`; ledger `HELD` 0 and `COOPERATIVE_PAYABLE` −12,250,000; the order's whole ledger sums to 0;
  - shortfall 25 of 30 → refund 32,500,000 (`SHORTFALL`), payouts 10,625,000 and 149,500,000; `payouts + fee (4,875,000) = paid − refunds (165,000,000)`;
  - two contributions 3 and 4 (Task 1 row 3) → farmer payouts 94,500 and 125,999 with the right farmer ids;
  - `large_share_is_split_into_transfer_parts`: a ₦48,500,000 farmer share → five payouts of 970,000,000 kobo, parts 1 to 5, references distinct;
  - `payout_during_bank_change_wait_uses_old_account`: the farmer confirms a bank change at T; the order completes at T + 47 h → the farmer payout's `recipientCode` is the old code; another order completing at T + 48 h gets the new one;
  - `farmer_without_recipient_is_blocked_not_skipped`: a farmer with no recipient code → their payout `BLOCKED`, amount intact, the cooperative's `QUEUED`, one admin alert email;
  - `completeOrder` twice (including two calls at once) → one set of payouts, one `order.released` group;
  - a farmer with a queued payout cannot leave the cooperative.
- [ ] **Step 2: Run** `npm test -- tests/integration/release.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema, migration (`--create-only --name payouts`), `complete.ts`, `payouts.ts` creation, the guard. Add `payoutAttempt`, `payout` to `cleanDatabase` before `refund`.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: completing an order refunds any shortfall and creates one payout per recipient` (body: account fixed at release; parts of at most ₦10,000,000; missing account blocks, never skips).

### Task 11: Payout gateway, sending and transfer webhooks

**Files:**
- Create: `src/modules/payments/payout-gateway.ts`, `src/modules/payments/job.ts`
- Modify: `src/lib/paystack.ts` (`initiateTransfer`, `verifyTransfer`, fake transfers), `src/modules/payments/payouts.ts`, `src/modules/payments/payments.ts` (transfer events), `src/modules/notifications/emails.ts` (`payoutAlertEmail`), `src/modules/notifications/recipients.ts` (active admins' emails), `src/lib/jobs/index.ts`, `vercel.json`
- Test: `tests/unit/paystack.test.ts`, `tests/integration/payouts.test.ts`

**Interfaces:**
- Produces:
  - `paystack.ts`: `initiateTransfer(input: { amountKobo: number; recipientCode: string; reference: string; reason: string }): Promise<{ transferCode: string; status: "success" | "pending" | "otp" | "failed" | "reversed" | string }>` → `POST /transfer` (`source: "balance"`); `verifyTransfer(reference: string): Promise<{ status: string; transferCode: string | null }>` → `GET /transfer/verify/:reference`. Fake: `fakePaystack.transfers: Map<reference, { amountKobo; recipientCode; status }>`, `fakePaystack.transferMode: "success" | "pending" | "fail" | "insufficient"`.
  - `payout-gateway.ts`: `interface PayoutGateway { send(input: { reference: string; amountKobo: number; recipientCode: string; reason: string }): Promise<{ outcome: "PAID" | "PENDING" | "FAILED" | "NO_FUNDS"; transferCode: string | null; failureReason: string | null }>; check(reference: string): Promise<"PAID" | "PENDING" | "FAILED" | "REVERSED"> }`; `paystackTransferGateway: PayoutGateway` (`otp` and `pending` → `PENDING`; a 400 "insufficient balance" → `NO_FUNDS`); `payoutGateway()` returns it (tests may pass another).
  - `sendDuePayouts(options: { orderId?: string; now?: Date; gateway?: PayoutGateway }): Promise<{ sent: number; deferred: number }>` (system function): for each `QUEUED` payout with `sendableAt ≤ now` (optionally of one order), claim it with a conditional update `QUEUED → SENT`, create the `PayoutAttempt` (`attempt = previous + 1`, `transferReference = <reference>-<attempt>`), then call `send`: `PAID` → payout `PAID`, `paidAt`, `payout.paid` ledger group, audit `payout.paid`; `PENDING` → stays `SENT`; `FAILED` → attempt and payout `FAILED`, audit `payout.failed` `{ payoutId, reason }`, admin alert; `NO_FUNDS` → attempt `FAILED` with reason `NO_FUNDS`, payout back to `QUEUED`, `sendableAt` + 24 h, `balanceRefusals + 1`, alert on the third. Job `payouts`, `vercel.json` `{ "path": "/api/cron/payouts", "schedule": "30 6 * * *" }`.
  - Webhook `transfer.success` / `transfer.failed` / `transfer.reversed` → `settleAttempt(transferReference, outcome)`: only an attempt still `SENT` changes (idempotent); success → payout `PAID` with the ledger group; failed or reversed → `FAILED` and alert. A `transfer.success` for a payout already `PAID` changes nothing.
  - `payoutAlertEmail(input: { kind: "FAILED" | "BLOCKED" | "NO_FUNDS" | "STALE" | "RECONCILIATION"; orderReference: string; amountKobo: number; recipientType: string }): { subject; text; html }` (no account details or names).
- [ ] **Step 1: Write the failing tests.** Unit: `initiateTransfer` posts `source: "balance"`, the amount, recipient and reference; `otp` maps to `PENDING`; a 400 "insufficient balance" maps to `NO_FUNDS`. `payouts.test.ts`:
  - before `sendableAt` nothing is sent; at `paidAt + 24 h` both payouts are sent, with references `…-1`, and fake transfers exist for exactly those amounts;
  - `payout_reference_is_unique`: inserting a second payout with the same reference throws P2002; running `sendDuePayouts` twice at once sends each payout once (one fake transfer per payout);
  - `pending_transfer_is_never_retried`: fake mode `pending` → payout `SENT`; `sendDuePayouts` again sends nothing; a `transfer.success` webhook → `PAID` and the `payout.paid` group; the same webhook again changes nothing;
  - fake mode `fail` → `FAILED`, one admin alert email to each active admin, never `PAID`;
  - fake mode `insufficient` → back to `QUEUED`, `sendableAt` a day later; the third refusal alerts admins;
  - after every payout is `PAID`, the order's ledger: payables 0, sum 0, and `sum(payouts paid) + PLATFORM_FEE credit = paid − refunds`.
- [ ] **Step 2: Run** `npm test -- tests/unit/paystack.test.ts tests/integration/payouts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the client calls, gateway, sender, webhook handling, alert email, job and cron entry.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: payouts by Paystack transfer behind a payout gateway, after funds clear` (body: pending transfers never retried; insufficient balance defers a day).

### Task 12: Failed and blocked payouts: retry and admin screen

**Files:**
- Create: `src/app/admin/payouts/page.tsx`, `src/app/admin/payouts/actions.ts`
- Modify: `src/modules/payments/payouts.ts`, `src/modules/payments/service.ts`, `src/modules/identity/policies.ts` (`"payout:manage"`: ADMIN), `tests/access/policy-matrix.test.ts`, `src/components/nav-links.ts`, `messages/*.json`
- Test: `tests/integration/payout-retry.test.ts`

**Interfaces:**
- Produces:
  - `listPayoutIssues(actor, now = new Date()): Promise<AdminPayout[]>` (`payout:manage`): `FAILED`, `BLOCKED`, `QUEUED` with `balanceRefusals > 0`, and `SENT` attempts older than 3 days. `AdminPayout = { id; orderReference; recipientType; recipientName; amountKobo; status; attempts: number; lastFailure: string | null; sentAt: string | null }` (no recipient code or account details).
  - `retryPayout(actor, payoutId, options: { useCurrentAccount: boolean }, now)`: `payout:manage`; `FAILED` only (`PAYOUT_NOT_FAILED`), and its last attempt `FAILED` or `REVERSED` as confirmed by `gateway.check` (`PAYOUT_STILL_PENDING` otherwise); with `useCurrentAccount`, `recipientCode = effectiveRecipientCode(owner, now)`; then `QUEUED` with `sendableAt = now` and `sendDuePayouts`; audit `payout.retry` `{ payoutId, useCurrentAccount }`.
  - `unblockPayout(actor, payoutId, now)`: `payout:manage`; `BLOCKED` only; takes `effectiveRecipientCode(owner, now)`, still none → `NO_RECIPIENT`; else `QUEUED`; audit `payout.unblock`.
  - `/admin/payouts` lists issues with Retry, Retry to current account, and Unblock; nav ADMIN gains it.
- [ ] **Step 1: Write the failing tests.** A failed payout retried → attempt 2 with reference `…-2`, `PAID`; retrying while Paystack still reports the last attempt pending → `PAYOUT_STILL_PENDING` and no new attempt; retry to current account after the farmer's bank change took effect uses the new code; a blocked payout after the farmer adds an account → `QUEUED` then `PAID`; unblock with still no account → `NO_RECIPIENT`; an officer → `ForbiddenError`; `listPayoutIssues` JSON has no `RCP_`. Matrix row for `payout:manage`.
- [ ] **Step 2: Run** `npm test -- tests/integration/payout-retry.test.ts tests/access/policy-matrix.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions, page and copy.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: admins retry failed payouts and unblock payouts once an account exists`.

### Task 13: Cancellation and refunds

**Files:**
- Create: `src/modules/orders/cancel.ts`
- Modify: `prisma/schema.prisma` (Order gains `cancelRequestedAt DateTime?`, `cancelledByCooperative Boolean @default(false)`; migration `order_cancellation`), `src/modules/orders/service.ts`, order screens, `messages/*.json`
- Test: `tests/integration/cancel.test.ts`

**Interfaces:**
- Produces:
  - `cancelOrder(actor, orderId, reason: string, now)`: buyer (`order:own`) from `PAID_HELD` → `REFUNDED` at once with a full refund (`BUYER_CANCEL`); buyer from `PREPARING` → sets `cancelRequestedAt` and posts "The buyer asked to cancel: <reason>" (status unchanged); officer (`order:manage`) from `PAID_HELD` or `PREPARING` → `REFUNDED`, full refund (`COOPERATIVE_CANCEL`), `cancelledByCooperative`, reason required (`REASON_REQUIRED`, 5 to 500 characters, message guards). Each refund is `refund.issued`, the lot returns to `LIVE` if it was `SOLD_OUT` and its available-until date has not passed; audit `order.cancel` `{ orderId, by, refundKobo }`.
  - `answerCancelRequest(actor, orderId, agree: boolean, now)`: `order:manage`; a pending request only (`NO_CANCEL_REQUEST`); agree → full refund (`BUYER_CANCEL`); decline → request cleared, thread line; audit.
  - Admin views count cooperative cancellations per cooperative (`cooperativeCancellations(cooperativeId)`, shown on the admin cooperative page).
- [ ] **Step 1: Write the failing tests.** Buyer cancels a `PAID_HELD` order → `REFUNDED`, refund 67,500,000 (delivery included), fake Paystack refund once, stock available again; a `SOLD_OUT` lot returns to `LIVE`; buyer asks to cancel a `PREPARING` order → still `PREPARING` with `cancelRequestedAt`; officer agrees → `REFUNDED`; officer declines → request cleared; cooperative cancels with reason → `REFUNDED`, `cancelledByCooperative`, count 1; no reason → `REASON_REQUIRED`; cancelling a `DELIVERED_MARKED` order → `ORDER_STATE`; refunding twice by two calls at once → one `Refund`; ledger sums to 0 after `refund.processed`.
- [ ] **Step 2: Run** `npm test -- tests/integration/cancel.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the migration (`--create-only --name order_cancellation`), functions, buttons and copy.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: buyer and cooperative cancellation with full refunds before delivery`.

### Task 14: Disputes, timeouts and the admin order queue

**Files:**
- Modify: `prisma/schema.prisma` (enum `DisputeStatus { OPEN RESOLVED }`, enum `DisputeOutcome { RELEASE REFUND_ALL REFUND_UNITS NOTE }`; model `Dispute { id, orderId, openedByUserId, kind String ("REPORT" | "TIMEOUT" | "SUSPENSION" | "AFTER_COMPLETION"), reason, status @default(OPEN), outcome DisputeOutcome?, unitsRefunded Int?, decisionNote String?, decidedByUserId String?, decidedAt DateTime?, createdAt; @@index([status, createdAt]) }`; migration `disputes`), `src/modules/orders/service.ts`, `src/modules/orders/job.ts`, `src/modules/cooperatives/service.ts` (list paid orders on suspension through `orders/service.ts`), `src/lib/jobs/index.ts`, `vercel.json`, `src/components/nav-links.ts`, `messages/*.json`
- Create: `src/modules/orders/disputes.ts`, `src/app/admin/orders/page.tsx`, `src/app/admin/orders/[id]/page.tsx`, `src/app/admin/orders/actions.ts`, `src/app/buyer/orders/[id]/report-form.tsx`
- Test: `tests/integration/disputes.test.ts`, `tests/integration/order-timers.test.ts`

**Interfaces:**
- Produces:
  - `AUTO_RELEASE_HOURS = 72`, `DELIVERY_TIMEOUT_DAYS = 14`.
  - `reportProblem(actor, orderId, reason, now)`: `order:own`; from `PAID_HELD`, `PREPARING` or `DELIVERED_MARKED` → `DISPUTED` and a `Dispute` (`REPORT`); from `COMPLETED` → a `Dispute` (`AFTER_COMPLETION`, no status change, no money action); reason 5 to 1000 characters through the message guards; posts "The buyer reported a problem" to the thread; audit `order.dispute_open`.
  - `runOrderTimers(now = new Date()): Promise<{ released: number; timedOut: number }>` (system): `DELIVERED_MARKED` with `deliveredMarkedAt ≤ now − 72 h` → `completeOrder(id, "AUTO", now)`; `PAID_HELD` or `PREPARING` with `paidAt ≤ now − 14 days` → `TIMED_OUT`, `timedOutAt`, a `Dispute` (`TIMEOUT`). Job `order-timers`, `{ "path": "/api/cron/order-timers", "schedule": "30 5 * * *" }`.
  - `listOrderQueue(actor, now): Promise<AdminQueueItem[]>` (`order:admin`): open disputes of every kind, oldest first, plus open orders of `SUSPENDED` cooperatives, plus payout issues (Task 12) and reconciliation issues (Task 16). `getOrderForAdmin(actor, orderId)`: the order, its thread, its delivery marks, its ledger totals and payouts (no bank data).
  - `resolveDispute(actor, disputeId, decision: { outcome: DisputeOutcome; unitsRefunded?: number; note: string }, now)`: `dispute:resolve`; `RELEASE` → `completeOrder(orderId, "ADMIN", now)`; `REFUND_ALL` → full refund (`ADMIN_DECISION`), `REFUNDED`; `REFUND_UNITS` → `completeOrder(orderId, "ADMIN", now, unitsRefunded)` (1 to delivered quantity − 1, `UNITS_RANGE`); `NOTE` (only for `AFTER_COMPLETION` and `SUSPENSION` with nothing to move) → resolved with the note; note required; `TIMED_OUT` orders may also be sent back to the cooperative (`DELIVERED_MARKED` is not an admin outcome); audit `dispute.resolve` `{ disputeId, outcome, unitsRefunded }`.
  - On cooperative suspension, each open order gets a `Dispute` (`SUSPENSION`) for the admin queue.
- [ ] **Step 1: Write the failing tests.**
  - `disputes.test.ts`: reporting a `DELIVERED_MARKED` order → `DISPUTED`; the buyer cannot confirm it (`ORDER_STATE`) and `runOrderTimers` at +4 days does not release it; admin `RELEASE` → payouts as Task 10; `REFUND_ALL` → full refund, no payouts; `REFUND_UNITS` 5 of 30 → refund 32,500,000 and payouts 10,625,000 and 149,500,000; units 30 → `UNITS_RANGE`; an officer resolving → `ForbiddenError`; a report after `COMPLETED` → a `NOTE`-only dispute and no money movement; `suspended_cooperative_orders_reach_admin_queue`: suspending a cooperative with a `PAID_HELD` order puts it in `listOrderQueue`.
  - `order-timers.test.ts`: delivered at T, at T + 71 h nothing; at T + 72 h released (payouts created), returns `{ released: 1 }`; a second run releases nothing; paid at P with no delivery mark: at P + 14 days `TIMED_OUT` with a `TIMEOUT` dispute; at P + 13 days nothing; the cron route runs `order-timers`.
- [ ] **Step 2: Run** `npm test -- tests/integration/disputes.test.ts tests/integration/order-timers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the migration (`--create-only --name disputes`), functions, job, cron, admin pages and buyer report form; nav ADMIN gains `/admin/orders`.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: report a problem freezes the payment; admins decide; 3-day auto-release and 14-day timeout`.

### Task 15: Receipts and earnings statements

**Files:**
- Create: `src/app/buyer/orders/[id]/receipt/page.tsx`, `src/app/farmer/earnings/page.tsx`, `src/app/farmer/earnings/[orderId]/page.tsx`
- Modify: `src/modules/orders/service.ts`, `src/modules/orders/views.ts`, `src/components/nav-links.ts`, `messages/*.json`
- Test: `tests/integration/statements.test.ts`

**Interfaces:**
- Produces:
  - `getReceipt(actor, orderId): Promise<Receipt>` (`order:own`; paid orders only, `ORDER_NOT_FOUND` otherwise): `Receipt = { reference; paidAt; cooperativeName; crop; unit; quantity; deliveredQuantity; unitKobo; goodsKobo; deliveryKobo; totalKobo; refunds: Array<{ amountKobo; reason; processed: boolean }>; netPaidKobo }`; copy says the cooperative is the seller and AgroHub the platform.
  - `listOwnEarnings(actor)`, `getEarningsStatement(actor, orderId): Promise<EarningsStatement>` (`earnings:own`; only orders on lots they contributed to): `EarningsStatement = { reference; crop; unit; contributedQuantity; deliveredQuantity; unitKobo; cutBps; feeBps; grossShareKobo; cutKobo; feeKobo; takeHomeKobo; payouts: Array<{ part; amountKobo; status: "WAITING" | "SENDING" | "PAID" | "PROBLEM"; paidAt }> }` (no buyer identity, no other farmer's share).
  - Nav FARMER gains `/farmer/earnings` ("Earnings").
- [ ] **Step 1: Write the failing tests.** For the Task 1 row 2 shortfall: the receipt shows total 197,500,000, a shortfall refund 32,500,000 and net 165,000,000; the farmer's statement shows take-home 149,500,000 and a `PAID` payout after the transfer webhook; for two contributions the first farmer's statement shows only 94,500 and no other farmer's id; another buyer's receipt → `ORDER_NOT_FOUND`; a farmer not on the lot → `ORDER_NOT_FOUND`; the statement JSON has no buyer name or email.
- [ ] **Step 2: Run** `npm test -- tests/integration/statements.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the reads, views and print-friendly pages.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: buyer receipts and farmer earnings statements`.

### Task 16: Daily reconciliation and alerts

**Files:**
- Modify: `prisma/schema.prisma` (model `ReconciliationIssue { id, kind String, reference String, detail Json (ids, amounts, statuses only), resolvedAt DateTime?, resolvedByUserId String?, createdAt; @@unique([kind, reference]) }`; migration `reconciliation`), `src/modules/payments/job.ts`, `src/lib/jobs/index.ts`, `vercel.json`, `src/app/admin/orders/page.tsx`
- Create: `src/modules/payments/reconcile.ts`
- Test: `tests/integration/reconciliation.test.ts`

**Interfaces:**
- Produces:
  - `reconcile(now = new Date(), gateway = payoutGateway()): Promise<{ issues: number }>` (system): (1) every successful Paystack transaction of the last 3 days (`listTransactions`) has a `SUCCEEDED` payment of the same amount; a missing one is first confirmed through `confirmPayment` (a webhook that never arrived), then recorded `UNCONFIRMED_PAYMENT` only if that fails; an amount difference → `AMOUNT_MISMATCH`; (2) every attempt `SENT` for over an hour is checked with `gateway.check` and settled like a webhook; still pending after 3 days → `STALE_TRANSFER`; (3) every `PENDING` refund without a Paystack id is retried once through `issueRefund`, with an id older than 3 days → `STALE_REFUND`; (4) per order touched in the last 3 days the ledger sums to 0, else `LEDGER_UNBALANCED`. New issues email admins once (unique key). Job `reconciliation`, `{ "path": "/api/cron/reconciliation", "schedule": "0 7 * * *" }`.
  - `resolveReconciliationIssue(actor, issueId, note)`: `order:admin`; audited.
- [ ] **Step 1: Write the failing tests.** A Paystack success whose webhook never came → the order becomes `PAID_HELD` through reconciliation and no issue is recorded; a Paystack transaction with an unknown reference → `UNCONFIRMED_PAYMENT`, one admin email, and a second run adds neither; `stale_pending_transfer_is_flagged`: a `SENT` attempt pending for 4 days → `STALE_TRANSFER`; a `SENT` attempt that Paystack now reports success → payout `PAID`; a pending refund with no Paystack id → called once; the issue appears in `listOrderQueue`; the cron route runs `reconciliation`.
- [ ] **Step 2: Run** `npm test -- tests/integration/reconciliation.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the migration (`--create-only --name reconciliation`), `reconcile.ts`, job, cron and the queue entries.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: daily reconciliation against Paystack with admin alerts`.

### Task 17: Money invariants sweep, full journey, docs and PR

**Files:**
- Create: `tests/integration/money-invariants.test.ts`, `tests/e2e/payout.spec.ts`
- Modify: `tests/e2e/lot-world.ts`, `docs/architecture.md` (sections 5 to 8 as built: payouts, attempts, disputes, reconciliation, jobs and their times), `docs/environments.md`, `docs/superpowers/plans/2026-10-31-agrohub-roadmap.md` (tick 5.5 to 5.11)

- [ ] **Step 1: Write the failing tests.**
  - `money-invariants.test.ts`: a fast-check property over at most 25 runs, each a random order (unit 1 to 100,000,000 kobo, quantity 1 to 200, cut 0 to 500, fee 0 to 1000, delivery 0 to 5,000,000, 1 to 3 contributions) driven through a random path (pay; then one of: complete; shortfall; buyer cancel; cooperative cancel; dispute refund all; dispute refund units; late duplicate refund) with all transfers and refunds settled by webhook. After each run: the order's ledger sums to 0; `HELD`, `COOPERATIVE_PAYABLE`, `FARMER_PAYABLE` and `REFUND_PAYABLE` are 0; `sum(paid payouts) + platform fee credited = amount paid − refunds processed`; no recipient has two payouts with the same part; each payout has exactly one successful attempt.
  - `payout.spec.ts` (fake Paystack): the buyer buys 10 bags, pays; the officer starts preparing, proposes a date, marks 8 of 10 delivered; the buyer sees "8 of 10 delivered: confirming refunds ₦130,000.00", confirms; the receipt shows the refund; the farmer's earnings statement shows their take-home, "Waiting"; the spec then calls the dev-only trigger `/api/dev/paystack/run-payouts` (fake mode only; it runs `sendDuePayouts` with `now = paidAt + 25 h`, since e2e cannot move the clock), and the statement reads "Paid". A second order: the buyer reports a problem, an admin (with 2FA, `enrolTwoFactor`) refunds all, the buyer sees "Refunded".
- [ ] **Step 2: Run** `npm test -- tests/integration/money-invariants.test.ts`, then the spec with `--workers=1`. Expected: FAIL.
- [ ] **Step 3: Implement** the dev trigger (404 unless Paystack is fake) and the doc edits.
- [ ] **Step 4: Run** the same commands, the full Playwright suite, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `test: money invariants across every order path; delivery and payout end to end; docs for Phase 5b`. Then a fresh whole-branch review on the most capable model, fix its findings (one commit per fix group), bring the branch up to date with `main`, and open PR "Phase 5b: delivery, release, payouts, refunds and disputes" with "Choices to check" and migrations `payouts`, `order_cancellation`, `disputes`, `reconciliation`.

---

## What you set up yourself

Nothing here needs a new environment variable: the webhook signature uses the existing `PAYSTACK_SECRET_KEY`, and the callback URL comes from `BETTER_AUTH_URL` (on previews, the Vercel branch URL).

**Before Part A is tried on staging**
1. **Paystack dashboard, Test mode → Settings → API Keys & Webhooks → Test Webhook URL:** `https://<staging-url>/api/paystack/webhook`, where `<staging-url>` is the stable staging address (the branch alias or custom domain, not a per-deployment hash URL). Paystack allows one test webhook URL per account.
2. **Vercel deployment protection on Preview:** if staging previews require Vercel login, Paystack's webhook gets 401. Either turn protection off for the staging deployment, or in Vercel → Project → Settings → Deployment Protection → "Protection Bypass for Automation", create the secret and add `?x-vercel-protection-bypass=<that secret>` to the webhook URL in step 1. You do this yourself; the secret never goes in the repo.
3. **Paystack Test mode → Settings → Preferences → Payment channels:** card, bank transfer and USSD on.
4. **Migration on staging:** `orders_payments` (commands below).

**Before Part B is tried on staging**
5. **Paystack Test mode → Settings → Preferences → Transfers:** turn off "Confirm transfers before sending" (OTP), or every test payout stays "awaiting Paystack". Live mode needs this too, after Paystack's conditions are met.
6. **Test balance:** test transfers draw on the test balance. If payouts show "Paystack balance too low" in `/admin/payouts`, check the test balance on the Paystack dashboard.
7. **Migrations on staging:** `payouts`, `order_cancellation`, `disputes`, `reconciliation`.
8. **Vercel crons** come from `vercel.json` on deploy: `order-expiry` 04:45, `order-timers` 05:30, `payouts` 06:30, `reconciliation` 07:00 (UTC, daily, within Hobby limits).

**Migration commands** (PowerShell; paste each URL from the Neon console yourself):

```powershell
$env:DATABASE_URL = "<direct, non-pooled URL of Neon branch staging>"; npx prisma migrate deploy
```

```powershell
$env:DATABASE_URL = "<direct URL of Neon branch production>"; npx prisma migrate deploy
```

**Not needed for test mode, needed before live money** (from Paystack's 4 November answer): Registered Business with compliance approved; a Manual Payout Account with Paystack's banking partner; transfer OTP off in live mode; the lawyer's view; live keys only in production.

## Open questions for you

1. **Two PRs (5a then 5b) or one?** The plan recommends two.
2. **Order and event emails stay deferred to Phase 8**, with only admin alerts sent now. Agree?
3. **Who covers a loss after release** stays open (legal); Phase 5 builds no money action after `COMPLETED`. Agree?
4. **Payouts wait 24 hours after payment for funds to clear**, and auto-release runs once a day (up to a day after the 3 days). Agree, or should payouts wait longer?
5. **First-payout verification hold:** still unanswered by Paystack; the plan shows such a transfer as "awaiting Paystack", never retries it, and flags it to admins after 3 days. If Paystack answers with a known wait, only the 3-day threshold changes.
