# AgroHub Phase 4: Marketplace, Offers and Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A buyer signs up, searches and filters live lots, opens a lot and its cooperative's public page, makes an offer, and negotiates it to an accepted offer: the officer accepts alone at or above the farmer's private floor, the farmer must agree below it, and nothing a buyer receives (pages, offer views, messages, errors) ever reveals the floor. Buyers and cooperatives, and farmers and officers, talk in message threads tied to a lot, with no phone numbers.

**Architecture:** Offers live in a new `src/modules/marketplace` (`offers.ts`, `limits.ts`, `views.ts`, `schema.ts`, `job.ts`, exported only through `marketplace/service.ts`). Threads and messages live in a new `src/modules/messaging` (`service.ts`, `guards.ts`, `views.ts`). Both read lots only through `catalog/service.ts`, which gains a public search (`searchLiveLots`), a public lot read (`getPublicLot`) and one server-internal read with the floor (`lotNegotiationFacts`) that never reaches a client. Buyer sign-up is a self-onboarding function in `identity/service.ts` (`becomeBuyer`), like `joinViaLink`. Buyer screens under `src/app/buyer/`, public pages at `src/app/lots/[id]/` and `src/app/cooperatives/[id]/`, officer offers under `src/app/officer/offers/`, and one `/messages` inbox for every role. Every screen uses the redesign kit (`src/components/ui/`).

**Tech Stack:** As Phase 3. No new dependencies: rate limits are counted in Postgres, and the floor and contact-detail guards are plain string checks.

**Spec:** `docs/superpowers/specs/2026-10-31-agrohub-design.md` sections 2 (anti-goals: buyer learning the floor, phone numbers visible, direct farmer contact), 3 (buyer verified by email and phone), 6.2 (phone confirmation falls back silently to email), 6.5, 6.12 (browsing is public; offers need a buyer account), 8 (rate limiting, access tests), 11, 13 (offers and counters expire after 48 hours; an accepted offer reserves stock for 24 hours), 14 (scheduled jobs safe to run twice). Roadmap: `2026-10-31-agrohub-roadmap.md` Phase 4 (4.1 to 4.6). Architecture: `docs/architecture.md` sections 2, 3, 5 (Offer, Thread, Message), 6 (Offer state machine), 8 (cron).

## Before Task 1: local setup (no commit)

- `npm ci`, then `npx prisma generate` (install scripts are skipped here).
- `docker exec agrohub-db-1 createdb -U <user> agrohub_p4_test` (user from `.env`'s `DATABASE_URL`), and a scratch database `agrohub_p4_scratch` for `prisma migrate dev`. Never run `migrate dev` against `agrohub`.
- Untracked `.superpowers/vitest.p4.mts` merges `../vitest.config.mts` with `DATABASE_URL` pointing at `agrohub_p4_test`; untracked `.superpowers/playwright.p4.ts` serves on port 3100 against the same database. `.superpowers/` is already ignored.
- Wherever a step below says `npm test -- <files>`, run it locally as `npx vitest run --config .superpowers/vitest.p4.mts <files>`; the full suite likewise. Playwright: `npx playwright test --config .superpowers/playwright.p4.ts --workers=1`, never at the same time as the integration tests.

## Global Constraints

- Money is integer kobo; percentages are integer basis points. No floats. Arithmetic and formatting only in `src/lib/money.ts`.
- The floor is never shown to buyers, including in rejections, counters, statuses, timings, errors, messages and audit rows. Private fields leave the server only through `views.ts` mappers.
- Offer at or above the floor: the officer can accept alone. Below it: the farmer must agree. Otherwise the officer rejects or counters. This is not an auction.
- Offers and counters expire after 48 hours. An accepted offer holds its quantity for 24 hours for the buyer to pay.
- Message threads are tied to a lot (orders arrive in Phase 5): buyer and cooperative; farmer and officer; admins can read and write in any thread. No phone numbers are shared. Buyers never reach farmers.
- Rate limits on offers (and, by this plan, on messages).
- Buyers can search and filter lots by crop, location, grade, price and quantity. Browsing is public; making an offer needs a buyer account.
- Buyer: verified by email and phone. Phone confirmation falls back silently to email confirmation and records the phone as unconfirmed for admins.
- Every scheduled job is safe to run twice (`runOnce`); Vercel Hobby allows at most daily crons.
- Offer decisions write to the append-only audit log. Audit `meta` holds ids, kobo amounts other than the floor, quantities and statuses only.
- All user-facing strings in `messages/*.json`, keys mirrored in all five files. Never call the held payment "escrow": say "payment held until delivery is confirmed".
- Business logic only in `src/modules/*/service.ts` (and files it re-exports); every service function takes an `Actor` and calls `can()` first (public and self-onboarding reads carry a comment saying why they have none). A module imports another only through its `service.ts`.
- Migrations are created with `npx prisma migrate dev --create-only` against the scratch database and reviewed; run `npx prisma generate` afterwards.
- Before each commit: `npm run lint`, `npm run typecheck`, `npm test`. No Co-Authored-By or "Generated with" lines. Stage files explicitly.

## Review Focus

1. A buyer infers the floor from how a below-floor offer behaves: a distinct status ("waiting for the farmer"), a reset expiry time, a different error or a slower answer. The buyer's view of an offer referred to the farmer must be identical to an untouched open offer (Task 5, `buyer_cannot_tell_offer_is_below_floor`; Task 7, `buyer_responses_never_contain_floor`).
2. Two acceptances on one lot at once (two officers, or an officer and a buyer accepting a counter, or a farmer agreeing) hold more than the lot's quantity: exactly the quantity can be held, the rest get `NOT_ENOUGH_STOCK` (Task 5, `concurrent_accepts_never_oversell`).
3. An offer past its 48 hours, or on a lot that was withdrawn, expired or whose cooperative was suspended, is acted on before the daily job runs: every response refuses it and every view shows it as expired or unavailable (Task 5, `offer_on_unavailable_lot_cannot_be_accepted`; Task 7, `expired_offer_cannot_be_accepted_before_job_runs`).
4. An officer types the floor or a phone number into a message, a rejection or a counter note: refused with a code the officer sees, nothing stored (Task 6, `officer_message_with_floor_is_refused`, `message_with_phone_number_is_refused`).
5. A buyer opens another buyer's offer or thread by id, or a user who farms or officers in a cooperative makes an offer on that cooperative's lot: `NotFoundError` (never Forbidden, so ids cannot be probed) and `OWN_COOPERATIVE_LOT` respectively (Task 4, `other_buyers_offer_is_not_found`, `cannot_offer_on_own_cooperative_lot`; Task 6, `other_buyers_thread_is_not_found`).

## Decisions this plan makes

Made by this plan (the spec is silent; each is flagged in the PR):

**Buyers**
- **Buyer sign-up reuses the existing sign-up form** (name, email, password, phone, consent; email verification required), then `/buyer/join` grants an ACTIVE `BUYER` membership with one button. A signed-in user with no officer or farmer membership is offered both "Register a cooperative" and "Buy produce".
- **Phone confirmation stays the silent fallback**: there is no SMS (a launch non-goal), so a buyer is confirmed by email and `phoneConfirmed` stays false for admins to see, exactly as for farmers in Phase 1.
- **One login may be a buyer and a farmer or officer**, but it cannot make offers on lots of a cooperative where it holds an ACTIVE farmer or officer membership (`OWN_COOPERATIVE_LOT`).

**Browsing**
- **Filters:** crop, pickup state (location is the state; LGA filtering is left out), grade, minimum and maximum price per unit (naira, through `toKobo`), and minimum lot quantity, plus a sort (newest, price low to high, price high to low). 24 lots per page with a `page` number. Invalid filter values are dropped, not errors, since they come from a URL.
- **Public pages show the lot's listed quantity**, not quantity net of accepted offers; held stock is checked when an offer is made and accepted. Phase 5's stock reservations take over the public figure.
- **SEO here means server-rendered pages with `generateMetadata`** (title, description, canonical); the sitemap is Phase 9. A lot that is not publicly visible, and a cooperative that is not VERIFIED, is a 404.
- **The public cooperative page** shows name, state, LGA, "Verified" with the verification month, and its live lots. No registration number, bank data, officer names or documents. Reviews arrive in Phase 6.

**Offers**
- **An offer is a price per unit and a whole quantity**: quantity from the lot's minimum order to its quantity less held stock (`BELOW_MIN_ORDER`, `NOT_ENOUGH_STOCK`); price 1 kobo to the asking price (`OFFER_ABOVE_ASK`). Buying outright at the asking price is Phase 5's checkout.
- **States:** `OPEN, AWAITING_FARMER, COUNTERED, ACCEPTED, REJECTED, EXPIRED, WITHDRAWN`. The architecture's list gains `AWAITING_FARMER`: an officer who accepts a below-floor offer refers it to the farmer, who agrees (`ACCEPTED`) or declines (`REJECTED`).
- **The buyer never sees `AWAITING_FARMER`.** Buyers get `BuyerOfferStatus = WAITING | COUNTERED | ACCEPTED | DECLINED | EXPIRED | WITHDRAWN`: `OPEN` and `AWAITING_FARMER` both read `WAITING`, and a referral keeps the offer's original `expiresAt`. A rejection by the officer or by the farmer both read `DECLINED`.
- **A counter is one price per unit**, above the offer, at most the asking price, and at or above the floor (`COUNTER_NOT_ABOVE_OFFER`, `COUNTER_ABOVE_ASK`, `COUNTER_BELOW_FLOOR`); the officer can never counter below the floor, so a counter needs no farmer. The counter gets a fresh 48 hours. The buyer accepts it (`ACCEPTED` at the counter price) or declines it (`WITHDRAWN`); to bargain further the buyer makes a new offer.
- **One live offer per buyer per lot**: a new offer withdraws the buyer's earlier `OPEN`, `AWAITING_FARMER` or `COUNTERED` offer on that lot. A buyer withdraws their own live offer at any time.
- **Offers carry no free text.** Notes go into the lot's buyer–cooperative thread: the offer form and the officer's reject and counter forms have an optional message field that is posted there through the same guards as any message.
- **Acceptance holds stock without a reservation table**: an accepted offer sets `payByAt = acceptedAt + 24 hours`, and held stock is the sum of accepted offers on the lot with `payByAt` in the future. Every acceptance locks the lot row (`SELECT ... FOR UPDATE`) and rechecks it. Phase 5 turns an accepted offer into a checkout and replaces this with `StockReservation`.
- **Expiry is enforced on read and by the daily job.** Any live offer whose `expiresAt` has passed, or whose lot is no longer publicly visible, is shown as expired and refuses every action (`OFFER_EXPIRED`, `LOT_NOT_AVAILABLE`); the `offer-expiry` job (04:30 UTC) marks such offers `EXPIRED` and marks accepted offers whose `payByAt` passed `EXPIRED` too (no payment exists until Phase 5).
- **Rate limits are counted in Postgres** with the buyer's user row locked during the count: at most 10 offers per buyer per rolling hour across all lots (`OFFER_RATE_LIMIT`), and at most 5 per buyer per lot per rolling 24 hours (`OFFER_LOT_LIMIT`). Constants in `marketplace/limits.ts`, not settings.

**Messages**
- **Threads are lot threads of two kinds**: `BUYER_COOPERATIVE` (one per lot and buyer; the buyer starts it, or making an offer does) and `FARMER_COOPERATIVE` (one per lot; the farmer or an officer starts it). Officers of the cooperative take part in both; admins can read and write in any thread. Order threads (Phase 5) and admin-started support threads (with disputes and reports) come later.
- **Buyers see the cooperative's name, never an officer's or farmer's name**; officers see the buyer's name; farmers never see buyer threads. Admin messages show as "AgroHub".
- **Contact details are refused, not masked**: a message containing a Nigerian phone number (`+234` or `0`, then 7, 8 or 9, with any spaces or dashes) or an email address is refused (`MESSAGE_HAS_CONTACT`), in every thread.
- **The floor guard is best effort on top of the real rule** (the system never sends the floor to a buyer): a cooperative-side or admin message in a buyer thread that contains the lot's floor as a number in kobo or naira (with or without commas, ₦ or `.00`) is refused (`MESSAGE_MENTIONS_FLOOR`).
- **Messages are plain text, 1 to 2000 characters**, at most 30 per user per rolling hour (`MESSAGE_RATE_LIMIT`). No read receipts or unread counts; threads list by latest message. New-message and offer emails are Phase 8 (email is blocked anyway).

---

### Task 1: Buyer sign-up

**Files:**
- Modify: `src/modules/identity/service.ts`, `src/components/nav-links.ts`, `src/app/actions/active-role.ts` (reuse its cookie setter), `messages/*.json`
- Create: `src/app/buyer/join/page.tsx`, `src/app/buyer/join/join-form.tsx`, `src/app/buyer/actions.ts`, `src/app/buyer/page.tsx` (placeholder home: "Browse lots" link; Task 8 fills it)
- Test: `tests/integration/buyer-join.test.ts`, `tests/unit/header-nav.test.ts`

**Interfaces:**
- Produces:
  - `becomeBuyer(user: { userId: string }): Promise<{ membershipId: string }>` in `identity/service.ts`: self-onboarding, no Actor (comment, like `joinViaLink`); user `emailVerified` (`ForbiddenError` `EMAIL_NOT_VERIFIED`); an existing ACTIVE BUYER membership is returned as is; otherwise creates one through `addMembership`-style insert and writes audit `buyer.join` `{ membershipId }`. Never touches `phoneConfirmed`.
  - `becomeBuyerAction(): Promise<ActionResult<{ membershipId: string }>>`: `currentUser()` or `UNAUTHENTICATED`; on success sets the active-membership cookie to the buyer membership and the page redirects to `/buyer`.
  - `/buyer/join`: signed out → what buying on AgroHub means, "payment held until delivery is confirmed", and a "Create a buyer account" link to `/sign-up?next=/buyer/join`; signed in → a "Start buying" button.
  - Nav: `BUYER: [{ href: "/lots", labelKey: "browseLots" }, { href: "/buyer", labelKey: "myOffers" }]` (Task 6 adds messages); `navLinksWithoutActiveMembership` returns `/officer/onboarding` and `{ href: "/buyer/join", labelKey: "buyProduce" }` when the user has no officer or farmer membership.

- [ ] **Step 1: Write the failing tests.** `buyer-join.test.ts`: a verified user → ACTIVE BUYER membership, one `buyer.join` audit row, `phoneConfirmed` still false; calling again returns the same membership id and writes no row; an unverified user → `EMAIL_NOT_VERIFIED`; a user who is an ACTIVE farmer can also become a buyer (two memberships). Nav: `navLinksFor("BUYER")` hrefs equal `["/lots", "/buyer"]`; `navLinksWithoutActiveMembership([])` includes `/buyer/join` and `/officer/onboarding`.
- [ ] **Step 2: Run** `npm test -- tests/integration/buyer-join.test.ts tests/unit/header-nav.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `becomeBuyer`, the action, the two pages, nav and messages.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: buyer sign-up; phone confirmation falls back silently to email` (body: buyer membership granted after email verification; phoneConfirmed stays false).

### Task 2: Search and filter live lots

**Files:**
- Modify: `src/modules/catalog/public.ts`, `src/modules/catalog/service.ts`, `src/modules/catalog/views.ts` (`PublicLot` gains `cooperativeId`), `src/app/lots/page.tsx`, `messages/*.json`
- Create: `src/modules/catalog/search-schema.ts`, `src/app/lots/filters.tsx`
- Test: `tests/integration/lot-search.test.ts`, `tests/unit/lot-search-schema.test.ts`

**Interfaces:**
- Consumes: `listLiveLots`'s visibility rule (Phase 3), `toKobo`, `STATES`, `listActiveCatalog`.
- Produces:
  - `parseLotFilters(params: Record<string, string | string[] | undefined>): LotFilters` (pure, drops invalid values): `LotFilters = { cropId?: string; state?: string; grade?: LotGrade; minPriceKobo?: number; maxPriceKobo?: number; minQuantity?: number; cooperativeId?: string; sort: "newest" | "price_asc" | "price_desc"; page: number }` (`page` ≥ 1, default 1; `sort` default `newest`; prices are naira strings in the URL `minPrice`, `maxPrice`).
  - `searchLiveLots(filters: LotFilters, now = new Date()): Promise<{ lots: PublicLot[]; page: number; hasMore: boolean }>`: public read, no Actor (comment); same visibility as `listLiveLots` (which now delegates to it); 24 per page, fetch 25 to set `hasMore`; ties broken by `id`.
  - `/lots`: a GET form (works without JavaScript) with crop select, state select, grade select, min and max price (naira), minimum quantity, sort, and "Clear"; result cards link to `/lots/[id]`; "Next page" and "Previous page" links keep the filters; an empty state that names the active filters.

- [ ] **Step 1: Write the failing tests.** `lot-search-schema.test.ts`: `{ minPrice: "500", grade: "A" }` → `minPriceKobo: 50000`, `grade: "A"`; `{ minPrice: "abc", grade: "Z", page: "-2", state: "Atlantis" }` → none of those set, `page: 1`; an array value takes the first. `lot-search.test.ts` (four live lots: Maize A in Oyo at ₦500, Maize B in Kano at ₦700, Yam A in Oyo at ₦900 qty 5, Yam C in Kano at ₦300 qty 50): crop Maize → 2; state Oyo → 2; grade A → 2; price ₦400 to ₦800 → 2; minQuantity 10 → 3; combined Maize + Oyo → 1; `price_asc` order is 300, 500, 700, 900; with 30 live lots page 1 has 24 and `hasMore`, page 2 has 6 and not; a lot in a suspended cooperative never appears; `JSON.stringify` of any result has no floor value.
- [ ] **Step 2: Run** `npm test -- tests/unit/lot-search-schema.test.ts tests/integration/lot-search.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the parser, `searchLiveLots`, the page and the filter form (selects and inputs at least 44 px, labels from messages).
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: buyers search and filter live lots by crop, state, grade, price and quantity`.

### Task 3: Public lot and cooperative pages

**Files:**
- Modify: `src/modules/catalog/public.ts`, `src/modules/catalog/service.ts`, `src/modules/cooperatives/service.ts`, `src/modules/cooperatives/views.ts`, `src/components/app-footer.tsx` (no change if "Harvest lots" already links `/lots`), `messages/*.json`
- Create: `src/app/lots/[id]/page.tsx`, `src/app/cooperatives/[id]/page.tsx`
- Test: `tests/integration/public-pages.test.ts`

**Interfaces:**
- Consumes: Task 2 `searchLiveLots` (with `cooperativeId`), `toPublicLot`, `photoUrlsOf`.
- Produces:
  - `getPublicLot(lotId: string, now = new Date()): Promise<PublicLot>`: public read, no Actor (comment); the lot only if publicly visible, else `NotFoundError` `LOT_NOT_FOUND` (a withdrawn, pending or expired lot looks exactly like a missing one).
  - `PublicCooperative = { id: string; name: string; state: string; lga: string; verifiedSince: string }` (`verifiedSince` `YYYY-MM` from `verifiedAt`) via `toPublicCooperative` in `cooperatives/views.ts`, built field by field.
  - `getPublicCooperative(cooperativeId: string): Promise<PublicCooperative>`: public read, no Actor; VERIFIED only, else `NotFoundError` `COOPERATIVE_NOT_FOUND`.
  - `/lots/[id]`: all photos, crop, quantity and unit, grade, pickup, price per unit, minimum order, available until, and "Sold by <cooperative>" linking to `/cooperatives/[id]`; an offer slot that Task 8 fills (for now: "Sign up as a buyer to make an offer" → `/buyer/join`). `generateMetadata` gives title "<quantity> <unit> of <crop> from <cooperative>", a description with price and pickup, and `alternates.canonical`. `notFound()` on `LOT_NOT_FOUND`.
  - `/cooperatives/[id]`: the public cooperative and its live lots (`searchLiveLots({ cooperativeId })`), with metadata; `notFound()` on `COOPERATIVE_NOT_FOUND`.

- [ ] **Step 1: Write the failing tests.** `getPublicLot` of a live lot returns it, and its JSON contains neither the floor's kobo value, `floor`, nor the farmer's id or name; a pending, withdrawn, past-available-until lot and a lot in a suspended cooperative → `LOT_NOT_FOUND`; `getPublicCooperative` of a VERIFIED cooperative returns exactly the keys `id, name, state, lga, verifiedSince` (no `recipientCode`, `registrationNumber`, `accountName`); PENDING and SUSPENDED → `COOPERATIVE_NOT_FOUND`.
- [ ] **Step 2: Run** `npm test -- tests/integration/public-pages.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the reads, view and both pages.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: public lot and cooperative pages with search-friendly metadata`.

### Task 4: Making offers, held stock and rate limits

**Files:**
- Modify: `prisma/schema.prisma` (enum `OfferStatus`, model `Offer`, relations on `Lot`, `User`, `Cooperative`), `src/modules/catalog/service.ts`, `src/modules/catalog/lots.ts`, `src/lib/money.ts`, `src/modules/identity/policies.ts`, `tests/access/policy-matrix.test.ts`, `tests/integration/helpers.ts`, `tests/integration/lot-fixtures.ts` (a `buyerMember` helper)
- Create: migration `offers`, `src/modules/marketplace/service.ts`, `src/modules/marketplace/offers.ts`, `src/modules/marketplace/limits.ts`, `src/modules/marketplace/schema.ts`, `src/modules/marketplace/views.ts`
- Test: `tests/integration/offers.test.ts`, `tests/unit/money.test.ts`

**Interfaces:**
- Consumes: Task 3's visibility rule; `saleBreakdown`.
- Produces:
  - `enum OfferStatus { OPEN AWAITING_FARMER COUNTERED ACCEPTED REJECTED EXPIRED WITHDRAWN }`.
  - `model Offer { id, lotId, cooperativeId, buyerUserId, quantity Int, offeredKobo Int, counterKobo Int?, agreedKobo Int?, status OfferStatus @default(OPEN), expiresAt DateTime, acceptedAt DateTime?, payByAt DateTime?, referredByUserId String?, decidedByUserId String?, decidedAt DateTime?, createdAt, updatedAt; @@index([lotId, status]); @@index([cooperativeId, status]); @@index([buyerUserId, createdAt]); @@index([status, expiresAt]) }` (`@@map("offer")`). All kobo values are per unit.
  - `lineTotalKobo(unitKobo: number, quantity: number): number` in `money.ts` (integer product; `RangeError` beyond `Number.MAX_SAFE_INTEGER`).
  - `lotNegotiationFacts(lotId: string, now = new Date()): Promise<NegotiationFacts>` in `catalog/lots.ts`, re-exported from `catalog/service.ts`: server-internal, no Actor (comment: the floor is in it, so only marketplace and messaging services call it and nothing returns it to a client). `NegotiationFacts = { id; cooperativeId; cooperativeName; farmerUserId; crop: string; unit: string; askKobo; floorKobo; quantity; minOrderQty; feeTerms: LotTerms | null; publiclyVisible: boolean }`. Missing lot → `NotFoundError` `LOT_NOT_FOUND`.
  - Actions: `"offer:make"`: BUYER; `"offer:own"`: BUYER and `ownerUserId === actor.userId`; `"offer:respond"`: OFFICER with own cooperative.
  - `limits.ts`: `OFFERS_PER_HOUR = 10`, `OFFERS_PER_LOT_PER_DAY = 5`, `OFFER_TTL_HOURS = 48`, `ACCEPT_HOLD_HOURS = 24`, `MESSAGES_PER_HOUR = 30`; `heldQuantity(tx, lotId, now): Promise<number>` (sum of ACCEPTED offers with `payByAt > now`).
  - `makeOfferInput` zod: `lotId`, `quantity` (int ≥ 1), `offeredKobo` (int ≥ 1), `message?` (≤ 2000; posted by Task 6, ignored until then).
  - `makeOffer(actor, input: MakeOfferInput, now = new Date()): Promise<BuyerOffer>`: `can(actor, "offer:make")`; lot publicly visible (`ConflictError` `LOT_NOT_AVAILABLE`); the user holds no ACTIVE FARMER or OFFICER membership in the lot's cooperative (`ForbiddenError` `OWN_COOPERATIVE_LOT`); `offeredKobo` ≤ ask (`OFFER_ABOVE_ASK`); quantity ≥ minimum order (`BELOW_MIN_ORDER`); in one transaction that first locks the buyer's user row: rate limits (`OFFER_RATE_LIMIT`, `OFFER_LOT_LIMIT`), quantity ≤ lot quantity − held (`NOT_ENOUGH_STOCK`), the buyer's earlier live offer on the lot → `WITHDRAWN`, create `OPEN` with `expiresAt = now + 48 h`, audit `offer.make` `{ offerId, lotId, quantity, offeredKobo }`. No check, error or timing branch here compares with the floor.
  - `BuyerOfferStatus = "WAITING" | "COUNTERED" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "WITHDRAWN"`; `buyerStatusOf(status: OfferStatus, expiresAt: Date, payByAt: Date | null, lotVisible: boolean, now: Date): BuyerOfferStatus`.
  - `BuyerOffer = { id; lot: { id; crop; unit; cooperativeName }; quantity; offeredKobo; counterKobo: number | null; agreedKobo: number | null; totalKobo: number; status: BuyerOfferStatus; expiresAt: string; payByAt: string | null; createdAt: string }` via `toBuyerOffer`, built field by field (`totalKobo` uses the agreed, else countered, else offered price).
  - `listOwnOffers(actor, now = new Date()): Promise<BuyerOffer[]>` (newest first) and `getOwnOffer(actor, offerId, now = new Date()): Promise<BuyerOffer>` (`offer:own`; another buyer's offer → `NotFoundError` `OFFER_NOT_FOUND`).

- [ ] **Step 1: Write the failing tests.** `money.test.ts`: `lineTotalKobo(6500000, 30)` → 195000000; a product above `MAX_SAFE_INTEGER` throws `RangeError`. `offers.test.ts`: a buyer offers 10 bags at ₦600 on a live lot (ask ₦650, floor ₦550, min order 5) → `WAITING`, `expiresAt` 48 h on, one `offer.make` audit row; an offer of ₦500 (below the floor) is accepted just the same and returns an identical shape; `offeredKobo` above ask → `OFFER_ABOVE_ASK`; 4 bags → `BELOW_MIN_ORDER`; a withdrawn lot → `LOT_NOT_AVAILABLE`; a second offer on the same lot withdraws the first; the eleventh offer within an hour → `OFFER_RATE_LIMIT`; the sixth on one lot within 24 h → `OFFER_LOT_LIMIT` (`now` moved forward past the hour so only the lot limit applies); a FARMER actor → `ForbiddenError`; `cannot_offer_on_own_cooperative_lot`: a user who is a buyer and an ACTIVE officer of the lot's cooperative → `OWN_COOPERATIVE_LOT`; `other_buyers_offer_is_not_found`: `getOwnOffer` on another buyer's offer → `OFFER_NOT_FOUND`. Matrix rows for `offer:make`, `offer:own`, `offer:respond`.
- [ ] **Step 2: Run** `npm test -- tests/unit/money.test.ts tests/integration/offers.test.ts tests/access/policy-matrix.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the model, migration (`--create-only --name offers`), helpers, policy rules, views and functions. Add `offer` to `cleanDatabase` before `lotRevision`.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: buyers make offers on live lots, with rate limits and held stock` (body: one live offer per buyer per lot; limits counted in Postgres under a row lock).

### Task 5: Negotiation: officer, farmer and buyer responses

**Files:**
- Modify: `src/modules/marketplace/offers.ts`, `src/modules/marketplace/service.ts`, `src/modules/marketplace/views.ts`, `src/modules/marketplace/schema.ts`
- Test: `tests/integration/negotiation.test.ts`

**Interfaces:**
- Consumes: Task 4 (`lotNegotiationFacts`, `heldQuantity`, `lineTotalKobo`, `saleBreakdown`).
- Produces:
  - `respondToOffer(actor, offerId, input: { decision: "ACCEPT" | "REJECT" | "COUNTER"; counterKobo?: number; message?: string }, now = new Date()): Promise<OfficerOffer>`: `can(actor, "offer:respond", { cooperativeId: offer.cooperativeId })` (another cooperative's offer → `NotFoundError` `OFFER_NOT_FOUND`); the offer `OPEN` and not past `expiresAt` (`OFFER_NOT_OPEN`, `OFFER_EXPIRED`); the lot publicly visible (`LOT_NOT_AVAILABLE`); each change is a conditional `updateMany where { id, status: "OPEN" }` (count 0 → `OFFER_NOT_OPEN`).
    - `ACCEPT` at or above the floor → `ACCEPTED`, `agreedKobo = offeredKobo`, `acceptedAt`, `payByAt = now + 24 h`, after locking the lot row and checking `quantity ≤ lot quantity − held` (`NOT_ENOUGH_STOCK`); audit `offer.accept` `{ offerId, agreedKobo, quantity }`.
    - `ACCEPT` below the floor → `AWAITING_FARMER`, `referredByUserId`; `expiresAt` unchanged; audit `offer.refer` `{ offerId }`.
    - `REJECT` → `REJECTED`; audit `offer.reject` `{ offerId }`.
    - `COUNTER` → rules from the Decisions; `COUNTERED`, `counterKobo`, `expiresAt = now + 48 h`; audit `offer.counter` `{ offerId, counterKobo }`.
    - `message`, when given, is posted to the buyer thread by Task 6 (ignored until then).
  - `farmerRespondToOffer(actor, offerId, agree: boolean, now = new Date()): Promise<FarmerOffer>`: `can(actor, "lot:own", { cooperativeId, ownerUserId: lot.farmerUserId })` (else `OFFER_NOT_FOUND`); `AWAITING_FARMER` only (`OFFER_NOT_AWAITING_FARMER`), not expired, lot visible; agree → `ACCEPTED` with the same lock and stock check, audit `offer.farmer_agree`; decline → `REJECTED`, audit `offer.farmer_decline`.
  - `respondToCounter(actor, offerId, accept: boolean, now = new Date()): Promise<BuyerOffer>`: `offer:own`; `COUNTERED` only (`OFFER_NOT_COUNTERED`), not expired, lot visible; accept → `ACCEPTED` at `agreedKobo = counterKobo` with the lock and stock check, audit `offer.counter_accept`; decline → `WITHDRAWN`, audit `offer.counter_decline`.
  - `withdrawOffer(actor, offerId): Promise<BuyerOffer>`: `offer:own`; from `OPEN`, `AWAITING_FARMER` or `COUNTERED` (`OFFER_NOT_LIVE`); audit `offer.withdraw`.
  - `OfficerOffer = { id; lotId; crop; unit; buyerName: string; quantity; offeredKobo; counterKobo; agreedKobo; askKobo; floorKobo; belowFloor: boolean; status: OfferStatus; expiresAt; payByAt; createdAt }` (no buyer email or phone). `FarmerOffer = { id; lotId; crop; unit; quantity; offeredKobo; breakdown: SaleBreakdown; status: OfferStatus; expiresAt }` (no buyer identity; the breakdown uses the lot's locked terms).
  - `listCooperativeOffers(actor, now = new Date()): Promise<OfficerOffer[]>` (`offer:respond`; live offers first, oldest first, then the last 30 decided); `getCooperativeOffer(actor, offerId, now)`; `listOffersAwaitingFarmer(actor, now = new Date()): Promise<FarmerOffer[]>` (FARMER: offers `AWAITING_FARMER` on their own lots).

- [ ] **Step 1: Write the failing tests** in `negotiation.test.ts` (ask ₦650, floor ₦550, quantity 30):
  - an officer accepts ₦600 for 10 → `ACCEPTED`, `payByAt` 24 h on, the buyer sees `ACCEPTED` and total ₦6,000;
  - `buyer_cannot_tell_offer_is_below_floor`: the buyer's `getOwnOffer` for a ₦500 offer is deep-equal before and after the officer's `ACCEPT` (which makes it `AWAITING_FARMER`); then the farmer agrees → the buyer sees `ACCEPTED` at ₦500; on another offer the farmer declines → the buyer sees `DECLINED`, the same as an officer rejection;
  - the farmer's `listOffersAwaitingFarmer` shows the ₦500 offer with take-home from the locked terms and no buyer name or id;
  - counter ₦620 on a ₦500 offer → buyer sees `COUNTERED` with ₦620 and a fresh `expiresAt`; buyer accepts → `ACCEPTED` at ₦620; counter ₦540 → `COUNTER_BELOW_FLOOR`; ₦700 → `COUNTER_ABOVE_ASK`; ₦500 → `COUNTER_NOT_ABOVE_OFFER`;
  - `concurrent_accepts_never_oversell`: three 12-bag offers on the 30-bag lot accepted at once by `Promise.allSettled` (officer, officer, buyer accepting a counter) → exactly two fulfilled, one `NOT_ENOUGH_STOCK`;
  - `offer_on_unavailable_lot_cannot_be_accepted`: after the farmer withdraws the lot, and separately after the cooperative is suspended, `respondToOffer` ACCEPT → `LOT_NOT_AVAILABLE`, and the buyer sees `EXPIRED`;
  - an officer of another cooperative → `OFFER_NOT_FOUND`; a second response to a decided offer → `OFFER_NOT_OPEN`; the buyer withdraws a `WAITING` offer → `WITHDRAWN`;
  - `offer_audit_never_contains_floor`: after refer, counter and accept, no `offer.*` audit row's `JSON.stringify(meta)` contains `55000`.
- [ ] **Step 2: Run** `npm test -- tests/integration/negotiation.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the four response functions, the reads and the two views.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: officers accept, reject or counter offers; below the floor the farmer decides` (body: AWAITING_FARMER reads as WAITING to the buyer with an unchanged expiry; held stock locked per lot).

### Task 6: Message threads

**Files:**
- Modify: `prisma/schema.prisma` (enums `ThreadKind`, `MessageSide`; models `Thread`, `Message`), `src/modules/identity/policies.ts` (`Resource.threadKind`), `tests/access/policy-matrix.test.ts`, `tests/integration/helpers.ts`, `src/modules/marketplace/offers.ts` (post the optional offer, reject and counter messages), `src/lib/money.ts`, `src/components/nav-links.ts`, `messages/*.json`
- Create: migration `threads`, `src/modules/messaging/service.ts`, `src/modules/messaging/guards.ts`, `src/modules/messaging/views.ts`, `src/app/messages/page.tsx`, `src/app/messages/[id]/page.tsx`, `src/app/messages/[id]/reply-form.tsx`, `src/app/messages/actions.ts`
- Test: `tests/unit/message-guards.test.ts`, `tests/integration/threads.test.ts`, `tests/unit/money.test.ts`, nav test

**Interfaces:**
- Consumes: `lotNegotiationFacts`, `MESSAGES_PER_HOUR`.
- Produces:
  - `enum ThreadKind { BUYER_COOPERATIVE FARMER_COOPERATIVE }`, `enum MessageSide { BUYER COOPERATIVE FARMER ADMIN }`.
  - `model Thread { id, kind ThreadKind, lotId, cooperativeId, counterpartUserId, createdAt, lastMessageAt DateTime @default(now()); @@unique([lotId, kind, counterpartUserId]); @@index([cooperativeId, lastMessageAt]); @@index([counterpartUserId, lastMessageAt]) }` (`@@map("thread")`); `model Message { id, threadId, authorUserId, side MessageSide, body String, createdAt; @@index([threadId, createdAt]); @@index([authorUserId, createdAt]) }` (`@@map("message")`). The counterpart is the buyer or the farmer.
  - Action `"thread:participate"`: ADMIN; OFFICER with own cooperative; BUYER with `ownerUserId === actor.userId` and `threadKind === "BUYER_COOPERATIVE"`; FARMER with `ownerUserId === actor.userId`, own cooperative and `threadKind === "FARMER_COOPERATIVE"`.
  - `amountsIn(text: string): number[]` in `money.ts`: every number in the text read as naira (commas, `₦`, `N` and decimals allowed) and as plain kobo, both in kobo; used only by the floor guard.
  - `guards.ts`: `hasContactDetails(text: string): boolean` (phone pattern and email pattern from the Decisions); `mentionsAmount(text: string, kobo: number): boolean` (`amountsIn(text).includes(kobo)`).
  - `openLotThread(actor, lotId, now = new Date()): Promise<{ threadId: string }>`: BUYER → the buyer thread for (lot, buyer), lot publicly visible (`LOT_NOT_AVAILABLE`) and not their own cooperative's (`OWN_COOPERATIVE_LOT`); FARMER → the farmer thread of their own lot (`lot:own`); OFFICER → the farmer thread of a lot in their cooperative. Upsert on the unique key, so a second call returns the same id.
  - `postMessage(actor, threadId, body: string, now = new Date()): Promise<ThreadView>`: participant check (non-participant → `NotFoundError` `THREAD_NOT_FOUND`); body trimmed, 1 to 2000 (`MESSAGE_LENGTH`); `hasContactDetails` → `ValidationError` `MESSAGE_HAS_CONTACT`; a cooperative-side or admin message in a buyer thread that `mentionsAmount(body, floorKobo)` → `MESSAGE_MENTIONS_FLOOR`; at most 30 messages per author per rolling hour under a lock on the author's user row (`MESSAGE_RATE_LIMIT`); `side` from the actor's role; sets `lastMessageAt`. No audit row (messages are their own record).
  - `getThread(actor, threadId): Promise<ThreadView>` (last 200 messages, oldest first) and `listOwnThreads(actor): Promise<ThreadSummary[]>` (BUYER and FARMER: their own; OFFICER: the cooperative's; ADMIN: the latest 100), newest activity first.
  - `ThreadView = { id; kind: ThreadKind; lot: { id; crop; unit }; title: string; messages: { id; side: MessageSide; author: string; body: string; createdAt: string; mine: boolean }[] }` via `toThreadView(row, viewer)`: for a BUYER viewer every cooperative-side author is the cooperative's name and `title` is the cooperative's name; for officers and admins the buyer's or farmer's name; ADMIN authors are "AgroHub". `ThreadSummary = { id; kind; lot: { id; crop; unit }; title; lastMessageAt; lastMessage: string }`.
  - `makeOffer` and `respondToOffer` (REJECT, COUNTER) post a non-empty `message` to the buyer thread with `postMessage`'s guards, before their own transaction, so a refused message refuses the whole action.
  - `/messages` lists `listOwnThreads` for any role; `/messages/[id]` shows the thread with a reply form; error codes mapped to messages ("Phone numbers and email addresses can't be shared in messages. Keep the conversation on AgroHub."). Nav: BUYER, OFFICER and FARMER gain `{ href: "/messages", labelKey: "messages" }`.

- [ ] **Step 1: Write the failing tests.**
  - `message-guards.test.ts`: `hasContactDetails` is true for "call 08031234567", "+234 803 123 4567", "0803-123-4567", "mail me at a@b.co", and false for "50 bags at 6,500 each" and "deliver on 12/11"; `mentionsAmount("can't go under ₦43,219.87", 4321987)`, `("43219.87")`, `("N43,219.87")` and `("4321987")` are true, `("₦43,000")` is false; `amountsIn("₦500 and 1,200.50")` contains 50000 and 120050.
  - `threads.test.ts`: a buyer opens a thread on a live lot and posts; an officer of the cooperative reads it and replies; the buyer's view shows the reply's author as the cooperative's name and never the officer's or farmer's name; `other_buyers_thread_is_not_found`: another buyer → `THREAD_NOT_FOUND`; the lot's farmer cannot read the buyer thread (`THREAD_NOT_FOUND`); an admin reads it and posts as "AgroHub"; `message_with_phone_number_is_refused`: a buyer's "call 08031234567" → `MESSAGE_HAS_CONTACT` and no row; `officer_message_with_floor_is_refused`: an officer's "lowest is ₦550" on a ₦550-floor lot → `MESSAGE_MENTIONS_FLOOR`, and the same text from the officer in the farmer thread is allowed; the 31st message in an hour → `MESSAGE_RATE_LIMIT`; the farmer and an officer talk in the farmer thread, and a buyer cannot open it; `openLotThread` twice returns one id; `respondToOffer` REJECT with a message naming the floor → `MESSAGE_MENTIONS_FLOOR` and the offer is still `OPEN`.
  - Matrix rows for `thread:participate`; nav includes `/messages` for BUYER, OFFICER, FARMER.
- [ ] **Step 2: Run** `npm test -- tests/unit/message-guards.test.ts tests/unit/money.test.ts tests/integration/threads.test.ts tests/access/policy-matrix.test.ts tests/unit/header-nav.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the models, migration (`--create-only --name threads`), guards, service, views, the offer-message wiring, pages and messages. Add `message`, `thread` to `cleanDatabase` before `offer`.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: lot message threads between buyers and cooperatives, and farmers and officers` (body: contact details refused, floor guard on the cooperative side, 30 messages an hour).

### Task 7: Offer expiry job and the buyer floor sweep

**Files:**
- Modify: `src/lib/jobs/index.ts`, `vercel.json`, `src/modules/marketplace/offers.ts`, `src/modules/marketplace/service.ts`
- Create: `src/modules/marketplace/job.ts`
- Test: `tests/integration/offer-expiry.test.ts`, `tests/integration/buyer-floor.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 6.
- Produces:
  - `expireOffers(now = new Date()): Promise<number>`: offers `OPEN`, `AWAITING_FARMER` or `COUNTERED` with `expiresAt ≤ now` or whose lot is no longer publicly visible, and `ACCEPTED` offers with `payByAt ≤ now`, become `EXPIRED` by conditional `updateMany` per offer, one `offer.expire` audit row each (actor null, `{ offerId, fromStatus }`); returns the count. Job `offer-expiry`; `vercel.json` gains `{ "path": "/api/cron/offer-expiry", "schedule": "30 4 * * *" }`.

- [ ] **Step 1: Write the failing tests.**
  - `offer-expiry.test.ts`: at `createdAt + 49 h` an open, a referred and a countered offer (counter made at +1 h, so it expires at +49 h) are expired and the call returns 3, writing three rows; an accepted offer at `acceptedAt + 25 h` expires; an offer at +47 h is untouched; a second call returns 0; `expired_offer_cannot_be_accepted_before_job_runs`: at +49 h with no job run, `respondToOffer` ACCEPT → `OFFER_EXPIRED`, `respondToCounter` → `OFFER_EXPIRED`, and the buyer sees `EXPIRED`; the cron route runs `offer-expiry` once per minute slot (follow `jobs.test.ts`).
  - `buyer-floor.test.ts`, `buyer_responses_never_contain_floor`: with floor 4321987 kobo (₦43,219.87) and ask ₦65,000, run the whole negotiation as the buyer would see it and collect, as JSON, every value a buyer-callable function returns and every error it throws (`{ name, code, message }`): `searchLiveLots`, `getPublicLot`, `getPublicCooperative`, `makeOffer` (above the floor, below the floor, and each refusal: above ask, below minimum order, not enough stock, rate limit), `getOwnOffer` and `listOwnOffers` after referral, farmer decline, counter and acceptance, `respondToCounter`, `withdrawOffer`, `openLotThread`, `getThread` and `listOwnThreads` after the officer replied and after the officer's floor message was refused. Assert none contains `4321987`, `43219.87`, `43,219.87` or the word `floor` (case-insensitive), and none contains the farmer's id or name.
- [ ] **Step 2: Run** `npm test -- tests/integration/offer-expiry.test.ts tests/integration/buyer-floor.test.ts`. Expected: FAIL (the sweep fails only if a leak exists; if it passes at once, break `toBuyerOffer` locally to see it fail, then restore).
- [ ] **Step 3: Implement** `expireOffers`, its job and cron entry.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: daily offer-expiry job; buyer responses never contain the floor`.

### Task 8: Buyer screens

**Files:**
- Modify: `src/app/lots/[id]/page.tsx`, `src/app/buyer/page.tsx`, `src/app/buyer/actions.ts`, `messages/*.json`
- Create: `src/app/lots/[id]/offer-form.tsx`, `src/app/buyer/offers/[id]/page.tsx`, `src/app/buyer/offers/[id]/counter-response.tsx`, `src/components/offers/status.ts`, `src/components/offers/error-key.ts`
- Test: `tests/unit/offer-ui.test.ts`

**Interfaces:**
- Consumes: Tasks 3 to 6 (`makeOffer`, `getOwnOffer`, `listOwnOffers`, `respondToCounter`, `withdrawOffer`, `openLotThread`, `getThread`, `postMessage`).
- Produces:
  - Actions returning `ActionResult`: `makeOfferAction({ lotId, quantity, price, message })` (`price` naira string via `toKobo`, `SyntaxError` → `INVALID_PRICE`), `respondToCounterAction({ offerId, accept })`, `withdrawOfferAction({ offerId })`, `startThreadAction({ lotId })` (returns `threadId`). Each revalidates `/buyer`, `/buyer/offers/[id]` and `/officer/offers`.
  - `offerErrorKey(code: string): string` in `components/offers/error-key.ts`, with a fallback key; `buyerStatusLabelKey(status: BuyerOfferStatus): string` in `status.ts`.
  - On `/lots/[id]`: an active BUYER sees the offer form (quantity defaulting to the minimum order, price per unit defaulting to the asking price, a live total from `lineTotalKobo`, an optional message, and "Payment is held until delivery is confirmed" in the explainer) and "Message the cooperative"; a signed-in user with a buyer membership but another active role sees "Switch to your buyer role to make an offer"; others see the `/buyer/join` link.
  - `/buyer`: "My offers" from `listOwnOffers` with status chips ("Waiting for the cooperative", "Counter offer", "Accepted: pay by <time>", "Declined", "Expired", "Withdrawn"); accepted offers say payment opens in a later release (Phase 5) without promising a date.
  - `/buyer/offers/[id]`: the offer, the counter with Accept / Decline, Withdraw while live, and the lot's buyer thread inline with a reply form.

- [ ] **Step 1: Write the failing test.** `offer-ui.test.ts`: `offerErrorKey("OFFER_RATE_LIMIT")` and each code `makeOffer` throws map to a key present in `en.json`; an unknown code maps to the fallback; `buyerStatusLabelKey` covers all six statuses and every key exists in `en.json`.
- [ ] **Step 2: Run** `npm test -- tests/unit/offer-ui.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the actions, pages and copy (phone-first, controls at least 44 px).
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS. (The journey is proved end to end in Task 10.)
- [ ] **Step 5: Commit** `feat: buyer offer form, offers page and counter responses`.

### Task 9: Officer and farmer offer screens

**Files:**
- Modify: `src/components/nav-links.ts`, `src/app/farmer/lots/page.tsx`, `src/app/farmer/lots/[id]/page.tsx`, `src/app/farmer/lots/actions.ts`, `src/app/officer/lots/[id]/page.tsx` (link to the farmer thread), `messages/*.json`
- Create: `src/app/officer/offers/page.tsx`, `src/app/officer/offers/[id]/page.tsx`, `src/app/officer/offers/[id]/offer-actions.tsx`, `src/app/officer/offers/actions.ts`, `src/app/farmer/lots/[id]/offer-decision.tsx`
- Test: nav test

**Interfaces:**
- Consumes: Task 5 (`listCooperativeOffers`, `getCooperativeOffer`, `respondToOffer`, `listOffersAwaitingFarmer`, `farmerRespondToOffer`), Task 6 (`openLotThread`, `getThread`, `postMessage`).
- Produces:
  - Actions: `respondToOfferAction({ offerId, decision, counter, message })` (`counter` naira via `toKobo`), `farmerRespondToOfferAction({ offerId, agree })`, `openFarmerThreadAction({ lotId })`. Each revalidates `/officer/offers`, `/farmer/lots` and `/buyer`.
  - `/officer/offers`: live offers first (buyer name, lot, quantity, price, "below the farmer's lowest price" chip, time left), then recent decisions. `/officer/offers/[id]`: the offer against the ask and the floor (labelled "Farmer's lowest price, private"); Accept (below the floor its label reads "Send to the farmer to agree" and explains why), Reject with optional message, Counter with price and optional message; the buyer thread inline.
  - Farmer: on `/farmer/lots` an "Offers waiting for you" panel; on `/farmer/lots/[id]` each such offer with quantity, price and the take-home breakdown, and Agree / Decline; a "Message your officer" link that opens the farmer thread.
  - Nav: OFFICER gains `{ href: "/officer/offers", labelKey: "offers" }`.

- [ ] **Step 1: Write the failing test.** Nav: `navLinksFor("OFFICER")` includes `/officer/offers` and `/messages`.
- [ ] **Step 2: Run** `npm test -- tests/unit/header-nav.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the pages, actions and copy (error codes through `offerErrorKey`).
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: officer offer queue and farmer agreement screens`.

### Task 10: End-to-end negotiation, seed and docs

**Files:**
- Create: `tests/e2e/marketplace.spec.ts`
- Modify: `tests/e2e/lot-world.ts` (return what the new spec needs, e.g. a live lot), `tests/e2e/journey.ts` (a `becomeBuyer` helper if shared), `prisma/seed.ts`, `tests/integration/seed.test.ts`, `docs/architecture.md` (section 5: `Offer` fields with `agreedKobo`, `payByAt`, `referredByUserId`; `Thread` and `Message`; section 6: the Offer state machine with `AWAITING_FARMER`, accepted offers expiring at `payByAt`; section 8: the `offer-expiry` job), `docs/superpowers/plans/2026-10-31-agrohub-roadmap.md` (tick 4.1 to 4.6)

**Interfaces:**
- Consumes: everything above.
- Produces: the seed adds a buyer `seed-buyer@example.com` (name "Seed Buyer") with an ACTIVE BUYER membership. No seeded offers or lots. Re-running adds nothing.

- [ ] **Step 1: Write the failing tests.** `seed.test.ts`: after seeding twice there is one `seed-buyer@example.com` with one ACTIVE BUYER membership. `marketplace.spec.ts`: set up a live lot with `setUpLotWorld` (Maize, 30 bags, ask ₦65,000, floor ₦43,219.87, minimum order 5); a new user signs up, verifies by the outbox link, opens "Buy produce", starts buying; on "Browse lots" filters by the crop and by grade A and sees the lot; opens it and the cooperative's page; offers 10 bags at ₦40,000 with the message "Can you deliver to Ibadan?"; tries to message "call 08031234567" and sees the refusal; the officer opens "Offers", sees the private floor and the below-the-floor chip, and sends it to the farmer; the buyer's offer still reads "Waiting for the cooperative"; the farmer opens "My lots", sees the offer with their take-home, and agrees; the buyer's offer reads "Accepted". Then a second offer at ₦42,000: the officer counters ₦50,000, the buyer accepts the counter and sees "Accepted" at ₦50,000. Across every buyer page visited, the page text never contains "43,219.87" or "4321987". Scope locators to `getByRole("main")`.
- [ ] **Step 2: Run** `npm test -- tests/integration/seed.test.ts`, then the Playwright spec with `--workers=1` (never at the same time as the integration tests). Expected: FAIL.
- [ ] **Step 3: Implement** the helpers, the seed addition and the doc edits.
- [ ] **Step 4: Run** the same commands, the full Playwright suite with `--workers=1`, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `test: buyer negotiation end to end; seed buyer and docs for Phase 4`.

**Phase done when:** a buyer negotiates a lot to an accepted offer (Task 10's journey passes locally, and on staging after the `offers` and `threads` migrations are applied), and `buyer_responses_never_contain_floor` passes. Then, once PR #11 has merged, bring this branch up to date with `main`, rerun lint, typecheck and the tests, and open the PR "Phase 4: marketplace, offers and messages" to `main`, listing every decision above under "Choices to check" and the two staging migrations.
