# AgroHub Roadmap (all phases)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each phase's plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This roadmap is not executed directly: before each phase, write that phase's detailed plan with superpowers:writing-plans, using this file as the scope. Phase 0 already has one.

**Goal:** Ship AgroHub, a phone-first platform where verified Nigerian farmer cooperatives sell harvests to bulk buyers with payment held until delivery, track prices and record group input orders.

**Architecture:** One Next.js app with domain modules (`src/modules/*`) holding all business logic, Prisma on Neon Postgres, Better Auth for login, Paystack for payments, Resend for email. Details in `docs/architecture.md`.

**Tech Stack:** Next.js (App Router), TypeScript, Tailwind, Prisma, Neon Postgres, Better Auth, Resend, Paystack, Vercel, Vitest, Playwright, next-intl, zod.

**Spec:** `docs/superpowers/specs/2026-10-31-agrohub-design.md`

## Global Constraints

- One Next.js app in one repo: TypeScript, Tailwind, Neon Postgres, Prisma, Better Auth, Resend, Paystack, Vercel.
- Naira only; money stored in kobo (whole numbers); percentages in basis points.
- Nigeria Data Protection Act: consent at sign-up, a privacy notice, deletion on request; financial records kept but stripped of personal details.
- Phone numbers are visible to admins only. Bank account numbers are never stored by AgroHub (Paystack recipient codes only).
- The floor price is never shown to buyers, including in rejections.
- Fee terms are locked to a lot on approval; later changes apply only to new lots.
- Stock reserved about 15 minutes at checkout; offers and counters expire after 48 hours; an accepted offer holds stock 24 hours; auto-release 3 days after the officer marks delivery; 14-day delivery timeout.
- Two-factor authentication is mandatory for every admin role.
- English is the default; Pidgin, Hausa, Yoruba and Igbo are enabled only after a native speaker reviews them.
- The held-payment feature is never described as escrow in the app, terms or pitch.
- Phone-first and low-data: photos compressed on upload, drafts kept if the connection drops.
- Separate staging and live environments with separate keys; staging uses Paystack test keys only; backups with a tested restore.

## Review Focus

Failure modes the spec implies that no feature task would otherwise test, most likely first. Each has a named test in the owning phase.

1. Two buyers pay for the last stock at once: the later payment is refunded automatically. Phase 5, test `concurrent_last_unit_refunds_later_payment`.
2. Paystack sends the same webhook twice or out of order: one payment record and one payout per recipient. Phase 5, tests `duplicate_webhook_creates_one_payment`, `payout_reference_is_unique`.
3. An officer who is also a farmer approves their own lot, including in a one-person cooperative: blocked, and an admin approves when no other officer exists. Phase 0 policy matrix and Phase 3, test `officer_cannot_approve_own_lot`.
4. The floor price appears in any buyer-facing response, error, email or message. Phases 3 and 4, test `buyer_responses_never_contain_floor`.
5. A bank detail change is requested and a payout falls due inside the 48-hour wait: the payout goes to the old account. Phases 1 and 5, test `payout_during_bank_change_wait_uses_old_account`.

---

## Phase 0: Foundation (detailed plan written)

Plan: `2026-10-31-agrohub-phase-0-foundation.md`. **Done when:** staging deploys, `/api/health` answers, an admin with 2FA can sign in and switch roles, the policy matrix passes, and CI is green.

## Phase 1: Cooperatives, verification and farmers

**Depends on:** Phase 0. Spec 6.1, 6.2, 14.
- [ ] 1.1 Private storage adapter: `src/lib/storage.ts` with `putPrivate(key: string, body: Buffer, contentType: string): Promise<void>` and `signedUrl(key: string, ttlSeconds: number): Promise<string>`.
- [ ] 1.2 Cooperative sign-up and document upload: `cooperatives/service.ts` `createCooperative(actor, input)`, `uploadDocument(actor, cooperativeId, file)`.
- [ ] 1.3 Admin verification queue: `verifyCooperative`, `rejectCooperative`, `suspendCooperative`, `reinstateCooperative`; status emails; waiting-time display.
- [ ] 1.4 Bank recipient: `src/lib/paystack.ts` `createRecipient(input): Promise<{ recipientCode: string; accountName: string }>`; registered-name check; 48-hour `BankChangeRequest` with email confirmation and admin alert.
- [ ] 1.5 Invite links: `createInviteLink`, `regenerateInviteLink` (revokes the old one), `joinViaLink`.
- [ ] 1.6 Farmer registration: email, phone, consent, profile (farm size, crops, state, LGA), bank; phone confirmation falling back silently to email.
- [ ] 1.7 Officer approval queue, direct invite, removal and leaving rules (blocked while orders are unfinished).
- [ ] 1.8 Certificate-expiry job and annual re-verification reminders.

**Done when:** on staging, a cooperative is verified, a farmer joins by link and is approved, and every new action has rows in the policy matrix.

## Phase 2: Crops, units and the price board

**Depends on:** Phase 1. Spec 6.4.
- [ ] 2.1 Crop and unit management by board admin.
- [ ] 2.2 Weekly price entry: `board/service.ts` `recordPrice(actor, { cropId, market, weekOf, priceKobo })`.
- [ ] 2.3 Public price board page.
- [ ] 2.4 `priceDeviation(askKobo: number, boardKobo: number, thresholdBps: number): 'OK' | 'HIGH' | 'LOW'`.

**Done when:** a board admin publishes prices and a farmer can see them.

## Phase 3: Harvest lots and officer screening

**Depends on:** Phase 2. Spec 6.3, 13, 14.
- [ ] 3.1 `computeBreakdown(askKobo, quantity, cutBps, platformFeeBps)` returning cooperative cut, AgroHub fee and farmer take-home.
- [ ] 3.2 Lot submission with private floor, note, photos compressed on upload, and the neutral price warning.
- [ ] 3.3 `catalog/views.ts` `toPublicLot(lot): PublicLot` whose type has no floor field.
- [ ] 3.4 Officer screening: approve, reject with reason, counter; farmer accepts or declines a counter.
- [ ] 3.5 Self-approval rule and admin fallback (test `officer_cannot_approve_own_lot`).
- [ ] 3.6 Fee terms locked on approval (`LotFeeTerms`).
- [ ] 3.7 Edit and withdraw: price or quantity changes create a pending revision; withdraw only with no open orders.
- [ ] 3.8 Lot expiry job; minimum order quantity; contributions per farmer.

**Done when:** a farmer's lot goes live after officer approval, with locked terms and no floor in any public output.

## Phase 4: Marketplace, offers and messages

**Depends on:** Phase 3. Spec 6.5, 13.
- [ ] 4.1 Browse and filter by crop, location, grade, price, quantity.
- [ ] 4.2 Public lot and cooperative pages (SEO-friendly).
- [ ] 4.3 Offers: `marketplace/service.ts` `makeOffer`, `respondToOffer`; officer accepts alone at or above the floor, farmer must agree below it; rejections never reveal the floor.
- [ ] 4.4 Message threads tied to a lot or order; no phone numbers exposed.
- [ ] 4.5 Offer rate limits; offer and counter expiry job (48 hours).
- [ ] 4.6 Buyer sign-up with email and phone confirmation.

**Done when:** a buyer negotiates a lot to an accepted offer and test `buyer_responses_never_contain_floor` passes.

## Phase 5: Orders, payment hold, delivery and payouts

**Depends on:** Phase 4. **Gate:** Paystack's written answer on holding funds and manual settlement is in hand, and you have confirmed the payment method. Spec 5.2, 6.6 to 6.8, 7, 13.
- [ ] 5.1 Order state machine (`orders/state.ts`) with legal transitions only.
- [ ] 5.2 Stock reservation under a row lock; 15-minute expiry job.
- [ ] 5.3 Paystack client: initialize, verify, refund; webhook route with signature check.
- [ ] 5.4 Payment records, `PaystackEvent` idempotency, append-only ledger with the zero-sum invariant.
- [ ] 5.5 Delivery schedule, delivery marking, buyer confirmation, 3-day auto-release, 14-day timeout.
- [ ] 5.6 `payments/payout-gateway.ts` interface and Paystack transfer implementation; payouts per recipient with unique references; payout waits for cleared funds.
- [ ] 5.7 Failed payouts: failed state, admin alert, retry; bank-change window rule.
- [ ] 5.8 Cancellation, shortfall and refunds (pro-rata shrink of farmer shares).
- [ ] 5.9 Disputes queue for admins; freeze on dispute.
- [ ] 5.10 Receipts and earnings statements.
- [ ] 5.11 Daily reconciliation against Paystack; payout and payment failure alerts.

**Done when:** in Paystack test mode a buyer pays, the officer delivers, the buyer confirms, and cooperative and farmers are paid exactly once; the Review Focus tests 1, 2 and 5 pass.

## Phase 6: Analytics, reviews and dashboards

**Depends on:** Phase 5. Spec 6.9, 6.13, 6.14.
- [ ] 6.1 Lot views, offers and sales counts for farmers; board comparison.
- [ ] 6.2 Reviews: one per completed order within 30 days, shown as "Verified buyer", average after 3 reviews, one cooperative reply, admin removal.
- [ ] 6.3 Role home dashboards and officer delivery schedule view.

## Phase 7: Group input orders, contributions and loans (tracking only)

**Depends on:** Phase 1. Spec 6.10.
- [ ] 7.1 Input orders with deadline and optional minimum total; voluntary farmer signups.
- [ ] 7.2 Contribution tracking and cancellation when the minimum is not met.
- [ ] 7.3 Loans tracker (records only; no money moves through AgroHub).

## Phase 8: Advice and alerts

**Depends on:** Phases 2 and 5. Spec 6.11. Weather alerts are deferred.
- [ ] 8.1 Season tips posted by admins.
- [ ] 8.2 Price-change alerts for followed crops.
- [ ] 8.3 Event emails for every event listed in the spec.

## Phase 9: Public site and launch hardening

**Depends on:** all earlier phases. Spec 6.12, 8.
- [ ] 9.1 Landing, about, how-to-join, SEO pages for verified cooperatives and lots.
- [ ] 9.2 Privacy notice and generic terms of service pages (lawyer review before real users).
- [ ] 9.3 Data deletion on request with financial records anonymized.
- [ ] 9.4 Security review: access matrix complete, rate limits, admin 2FA, secrets audit.
- [ ] 9.5 Backup restore test on a Neon branch.
- [ ] 9.6 Seeded demo data and a demo script for the pitch.
- [ ] 9.7 Launch checklist: Paystack live keys, lawyer, accountant, data protection registration, brand identity applied, translations reviewed.

## Process rules for every phase

- Branch per phase; one commit per task step group; pull request per phase.
- Each task starts with a failing test and ends with passing lint, typecheck and tests.
- Each phase ends with something that runs on staging.
- Update the checkboxes here when a task merges.
