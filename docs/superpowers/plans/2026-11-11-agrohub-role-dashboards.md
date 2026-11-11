# Role Home Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give farmer, officer, buyer and admin a to-do home page that they land on after sign-in.

**Architecture:** Each area gets small count-plus-three-items read functions in its own module's `service.ts`. A new `home` module assembles each role's tiles from them with `Promise.allSettled`, so one failing tile never breaks the page. Four server-rendered pages draw the tiles with one shared `Tile` component; landing, nav and links move to the new addresses.

**Tech Stack:** Next.js 16.4.3 (App Router, `cacheComponents` on), React 19.3, Prisma 7 on PostgreSQL, next-intl, Vitest (`unit`, `access`, `integration`), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-role-dashboards-design.md`. Read it with this plan; section numbers refer to it.

## Global Constraints

- Business logic only in `src/modules/*/service.ts` (or files its barrel re-exports). Pages call the `home` service only.
- Every service function takes an `Actor` and checks `can(actor, action, resource)` first. Cooperative data is scoped by `actor.cooperativeId`.
- Money is integer kobo, formatted only through `src/lib/money.ts` (`formatNaira`). Only a person's own earnings and receipts show amounts (spec section 3.4, last paragraph).
- Private fields (floor price, phone numbers, bank data) leave the server only through `views.ts` mappers. No tile item carries them.
- No new dependency, no migration, no new environment variable.
- Copy in `messages/en.json` under `home`; the other locale files get the same keys as empty strings (`tests/unit/i18n.test.ts` requires matching keys).
- Test first, commit after every task. Before each commit: `npm run lint`, `npm run typecheck`, `npm test`, delegated to the `test` subagent. Searches go to `search` / `grep`. The pull request records which subagent ran what.
- Integration tests and Playwright share the test database: never run them at once, and not while another session runs tests.
- No Co-Authored-By trailers and no "Generated with Claude Code" lines.
- Where the plan and spec are silent: the simpler option, noted in the commit and the pull request.
- Never merge. Push, open the pull request, stop.
- Test names are snake_case sentences.

## Review Focus

1. **The Lagos day boundary.** `deliveryDate` is a calendar day (`@db.Date`); "today" is `lagosDateKey(now)`. At 23:30 UTC (00:30 Lagos the next day), an order dated the Lagos "today" must be in the 14-day group, not overdue. Test in Task 4.
2. **A person with two roles** (farmer and buyer) using the buyer role opens `/farmer`. They are redirected to `/farmer/profile` and see their farm details, not a 404 or an error. Test in Task 10.
3. **An officer of an unverified cooperative** opens `/officer` directly. They see the "Finish onboarding" message, no tiles and no error. Test in Task 7.
4. **Long names at 375px wide** (a 60-character cooperative or crop name). Tile rows wrap and never scroll the page sideways. Checked in the Task 10 click-through.
5. **A count above 99.** It shows "99+" and the tile keeps its size. Tested in Task 1 (`countLabel`) and Task 7 (a real count of 101), and seen in the Task 10 click-through.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/summary.ts` | `Summary<T>`, `TileItem` types, `toSummary` helper |
| `src/modules/identity/policies.ts` | `home:view` action |
| `src/modules/{marketplace,catalog,farmers,orders,payments,cooperatives,name-changes,messaging}/summaries.ts` | each module's summary reads, re-exported from its `service.ts` |
| `src/modules/orders/schedule.ts` | `deliverySchedule` and its pure grouping helper |
| `src/modules/home/service.ts` | `farmerHome`, `officerHome`, `buyerHome`, `adminHome` |
| `src/components/home/tile.tsx`, `src/components/home/schedule.tsx` | the tile and the officer schedule |
| `src/app/{farmer,officer,buyer,admin}/page.tsx` | the four homes |
| `src/app/farmer/profile/page.tsx`, `src/app/buyer/offers/page.tsx` | the moved pages |
| `src/modules/identity/landing.ts`, `src/components/nav-links.ts`, `src/modules/notifications/views.ts` | landing, nav, alert links |

---

### Task 1: Summary types and the `home:view` policy

**Files:**
- Create: `src/lib/summary.ts`
- Modify: `src/modules/identity/policies.ts`
- Test: `tests/unit/summary.test.ts`, `tests/access/policy-matrix.test.ts`

**Interfaces:**
- Produces:

```ts
// src/lib/summary.ts
export type TileItem = {
  id: string;
  href: string;
  title: string;          // data only, e.g. "12 Bag · Maize" (quantity, unit, crop) or a person's name
  detail?: string;        // a name, or an amount already formatted with formatNaira
  date?: string;          // ISO date or date-time
  label?: string;         // a full message key, e.g. "orders.status.UNDER_REVIEW" or "home.labels.CANCEL_REQUESTED"
};
export type Summary = { count: number; items: TileItem[] };   // items: at most 3
export type History = { items: TileItem[] };                   // newest 3, no count
export const TILE_ITEMS = 3;
export function countLabel(count: number): string;             // "0".."99", then "99+"
```

- `"home:view"` in `Action`; `can` allows FARMER, OFFICER, BUYER, ADMIN; denies BOARD_ADMIN.

- [ ] **Step 1: Failing tests.** `countLabel(0) === "0"`, `countLabel(99) === "99"`, `countLabel(100) === "99+"`. In the policy matrix, five `home:view` rows: four `true`, BOARD_ADMIN `false`.
- [ ] **Step 2: Run, see them fail.** `npx vitest run tests/unit/summary.test.ts tests/access/policy-matrix.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit.** `feat: summary types and the home:view policy`

---

### Tasks 2, 3, 5, 6: the summary reads

These four tasks share one pattern.

**Pattern for each function:**

1. Signature `(actor: Actor, now: Date = new Date()) => Promise<Summary | History>` (Task 2's `farmerLotCounts` returns counts, see there).
2. First line: the same `can` check as its list counterpart named in spec section 3. Throw `ForbiddenError` when it fails.
3. The count is a `prisma.<model>.count({ where })`. The items are `findMany({ where, orderBy, take: TILE_ITEMS, select })`, oldest first for `Summary`, newest first for `History`. Never load more rows than three.
4. Items are mapped to `TileItem` in the module's `views.ts` (new `to<Thing>TileItem` mappers), selecting only the fields the item shows. `title` and `detail` hold data only (quantities, names, formatted amounts). Anything that needs words goes in `label` as a full message key: an existing key where one exists (the buyer order and offer status keys that `src/components/orders/status.ts` and `src/components/offers/status.ts` already use, and the officer order status keys behind `OFFICER_ORDER_TONE`), otherwise a new key under `home.labels` (for example `home.labels.CANCEL_REQUESTED` and one key per payout and reconciliation issue kind). The tile prints `t(label)`; it never prints a code.
5. Put the functions in a new `src/modules/<module>/summaries.ts` and re-export them from that module's `service.ts`.

**Tests for each function** (in `tests/integration/summaries-<role>.test.ts`, existing fixtures `lotWorld`, `paidWorld`, `paidOrder`, `seedOrder`, `farmerMember`, `officerMember`, `buyerMember`):
- `counts_only_<thing>`: rows that match, rows in other statuses, and rows of another cooperative or person. Asserts the count and that items are the right three in the right order.
- For functions marked "as `someList`" in spec section 3: `matches_<list>_count`, asserting `summary.count === (await someList(actor)).length` on the same data.
- `refuses_<role>`: each function rejects with `ForbiddenError` for the roles its list counterpart refuses, and an officer of another cooperative gets only their own rows. These touch the database, so they live in the same integration file, not in `tests/access` (which holds pure policy tests only).

Commit once per task.

### Task 2: Farmer summaries

**Files:** `src/modules/{marketplace,catalog,orders,messaging}/summaries.ts` (create), their `service.ts` and `views.ts`; `tests/integration/summaries-farmer.test.ts`.

| Function | Module | Where | Order | Item |
|---|---|---|---|---|
| `farmerOffersSummary` | marketplace | as `listOffersAwaitingFarmer` | `expiresAt` asc | title qty·unit·crop, date = `expiresAt`, href `/farmer/lots/{lotId}` |
| `farmerCounteredLotsSummary` | catalog | own lots (`farmerUserId`, `cooperativeId`), `COUNTERED` | `createdAt` asc | title crop, href `/farmer/lots/{id}` |
| `farmerLotCounts(actor): Promise<{ pendingReview: number; live: number; soldOut: number }>` | catalog | own lots, one `groupBy` on `status` | | |
| `recentEarningsSummary` (`History`) | orders | as `listOwnEarnings` | `completedAt` desc | title qty·unit·crop, detail = the farmer's amount from the statement view, formatted; href `/farmer/earnings/{orderId}` |
| `latestThreads` (`History`) | messaging | as `listOwnThreads` for the actor's role | `lastMessageAt` desc | title = thread title, date = `lastMessageAt`, href `/messages/{id}` |

`recentEarningsSummary` must take the farmer's amount from the same code that builds `EarningsStatement`, not recompute it. If that code cannot be called for three rows without loading 100, call `listOwnEarnings` and slice: earnings are capped at 100 rows already and this is a history tile. Say which you did in the commit.

### Task 3: Officer summaries

**Files:** `src/modules/{farmers,catalog,marketplace,orders}/summaries.ts`, `service.ts`, `views.ts`; `tests/integration/summaries-officer.test.ts`.

| Function | Module | Where | Order | Item |
|---|---|---|---|---|
| `pendingFarmersSummary` | farmers | as `listPendingFarmers(actor, actor.cooperativeId)` | `createdAt` asc | title = farmer name, href `/officer/farmers` |
| `screeningSummary` | catalog | as `listScreeningQueue` (officer branch for officers, admin branch for admins; Task 6 reuses it) | `createdAt` asc | title crop, href `/officer/lots/{id}` (admin: `/admin/lots/{id}`) |
| `catalogRequestsSummary` | catalog | as `listCooperativeCatalogRequests` | `createdAt` asc | title = requested name, href `/officer/farmers` |
| `officerOffersSummary` | marketplace | cooperative's offers, `OPEN`, `expiresAt > now` | `createdAt` asc | title qty·unit·crop, date `expiresAt`, href `/officer/offers/{id}` |
| `ordersToPrepareSummary` | orders | cooperative's orders, `PAID_HELD`, `cancelRequestedAt: null` | `paidAt` asc | title qty·unit·crop, detail buyer name, href `/officer/orders/{id}` |
| `officerAttentionSummary` | orders | cooperative's orders that are `DISPUTED` or `TIMED_OUT`, or `PAID_HELD`/`PREPARING` with `cancelRequestedAt` set | `updatedAt` asc | as above, label = the officer order status key, or `home.labels.CANCEL_REQUESTED` |

Officer summaries use `can(actor, "order:manage", { cooperativeId: actor.cooperativeId })` for orders (as `listCooperativeOrders`) and `offer:respond` for offers. Check the real action names against the list functions and use theirs.

### Task 4: The delivery schedule

**Files:**
- Create: `src/modules/orders/schedule.ts`
- Modify: `src/modules/orders/service.ts`, `src/modules/orders/views.ts`
- Test: `tests/unit/delivery-schedule.test.ts`, `tests/integration/delivery-schedule.test.ts`

**Interfaces:**

```ts
export type DeliveryRow = TileItem & { date: string };   // date = YYYY-MM-DD
export type DeliverySchedule = {
  overdue: DeliveryRow[];
  days: { date: string; orders: DeliveryRow[] }[];       // earliest first, only days that have orders
  more: number;                                          // rows past the 50-row cap (overdue + days)
  noDate: number;
  later: number;
};
export const SCHEDULE_DAYS = 14;
export const SCHEDULE_ROWS = 50;
// pure: splits rows dated up to the last day into overdue and per-day groups
export function groupSchedule(rows: DeliveryRow[], todayKey: string): Pick<DeliverySchedule, "overdue" | "days">;
export function scheduleWindow(now: Date): { todayKey: string; lastKey: string };
export async function deliverySchedule(actor: Actor, now?: Date): Promise<DeliverySchedule>;
```

`scheduleWindow`: `todayKey = lagosDateKey(now)`, `lastKey = addDays(todayKey, SCHEDULE_DAYS - 1)`. `groupSchedule` puts a row in `overdue` when `date < todayKey` and otherwise in its day's group; it is given only rows dated up to `lastKey`. `deliverySchedule` owns the three numbers: it loads the rows dated up to `lastKey` with `take: SCHEDULE_ROWS` ordered by `deliveryDate` asc, and runs three `count` queries over the same orders: dated up to `lastKey` (so `more = that count - rows shown`), `deliveryDate: null` (`noDate`), and dated after `lastKey` (`later`).

- [ ] **Step 1: Failing unit tests.** For `groupSchedule`: `puts_past_dates_in_overdue`, `groups_days_in_order`, `leaves_out_empty_days`. For `scheduleWindow`: `ends_on_the_fourteenth_day`, and Review Focus 1, `treats_lagos_today_as_today_after_utc_midnight` (now = `2026-11-11T23:30:00Z` gives todayKey `2026-11-12`, and a row dated `2026-11-12` is in `days`, not `overdue`).
- [ ] **Step 2: Failing integration tests:** `schedule_leaves_out_cancel_requests_and_other_cooperatives`, `schedule_reports_more_past_fifty_rows` (52 dated orders → 50 shown, `more` 2), `schedule_counts_undated_and_later_orders` (one undated, one dated the fifteenth day), and the table in spec section 3.2: `every_open_order_lands_where_the_table_says` (one order per row of that table across this task's schedule and Task 3's two summaries; `DELIVERED_MARKED` in none).
- [ ] **Step 3: Run, see them fail. Step 4: implement. Step 5: run, see them pass. Step 6: commit** `feat: the officer's delivery schedule`.

### Task 5: Buyer summaries

**Files:** `src/modules/{marketplace,orders}/summaries.ts`, `service.ts`, `views.ts`; `tests/integration/summaries-buyer.test.ts`.

| Function | Module | Where | Order | Item |
|---|---|---|---|---|
| `buyerOffersToActSummary` | marketplace | own offers: `ACCEPTED` with `payByAt > now`, or `COUNTERED` with `expiresAt > now` | `createdAt` asc | title qty·unit·crop, date = `payByAt` for accepted, label = the buyer offer status key (`buyerStatusLabelKey` of the buyer view, not the raw `OfferStatus`), href `/buyer/offers/{id}` |
| `deliveriesToConfirmSummary` | orders | own orders, `DELIVERED_MARKED` | `deliveredMarkedAt` asc | title qty·unit·crop, href `/buyer/orders/{id}` |
| `buyerOpenOrdersSummary` | orders | own orders in `PENDING_PAYMENT`, `PAID_HELD`, `PREPARING`, `DISPUTED`, `TIMED_OUT` | `createdAt` asc | title, label = the buyer order status key for `buyerOrderStatusOf` (`src/modules/orders/views.ts`), date = `deliveryDate` |
| `recentReceiptsSummary` (`History`) | orders | own orders `COMPLETED` | `completedAt` desc | title, detail = `formatNaira(totalKobo)`, href `/buyer/orders/{id}/receipt` |

A `PENDING_PAYMENT` order past its payment window shows the status `buyerOrderStatusOf` gives it, so expired checkouts do not look live.

### Task 6: Admin summaries

**Files:** `src/modules/{cooperatives,orders,payments,name-changes}/summaries.ts`, `service.ts`, `views.ts`; `tests/integration/summaries-admin.test.ts`.

| Function | Module | Where | Order | Item |
|---|---|---|---|---|
| `verificationSummary` | cooperatives | as `listVerificationQueue` | `submittedAt` asc | title = cooperative name, href `/admin/cooperatives/{id}` |
| `openDisputesSummary` | orders | disputes `OPEN` | `createdAt` asc | title qty·unit·crop of the order, href `/admin/orders/{orderId}` |
| `payoutIssuesSummary` | payments | as `listPayoutIssues` (all three branches) | `createdAt` asc | title = the crop of the payout's order, label = `home.labels.payout.<kind>` (one key per issue kind: failed, blocked, waiting for funds, stale), no amount, href `/admin/payouts` |
| `reconciliationSummary` | payments | as `listReconciliationIssues` | `createdAt` asc | title = the issue's reference, label = `home.labels.reconciliation.<kind>`, href `/admin/orders` |
| `nameChangeQueueSummary` | name-changes | as `listNameChangeQueue` | `createdAt` asc | title = the requested name, href `/admin/names/{id}` |

Lots to review reuse Task 3's `screeningSummary` (admin branch). Messages reuse Task 2's `latestThreads`. Admin tiles carry no amounts (spec section 3.4).

---

### Task 7: The `home` module

**Files:**
- Create: `src/modules/home/service.ts`, `src/modules/home/views.ts`
- Test: `tests/integration/home.test.ts`

**Interfaces:**

```ts
export type TileId =
  | "farmerOffers" | "farmerCountered" | "farmerLots" | "farmerEarnings"
  | "officerFarmers" | "officerLots" | "officerOffers" | "officerPrepare" | "officerAttention" | "officerRequests"
  | "buyerOffers" | "buyerConfirm" | "buyerOrders" | "buyerReceipts"
  | "adminCooperatives" | "adminDisputes" | "adminPayouts" | "adminReconciliation" | "adminNames" | "adminLots"
  | "messages";
export type Tile =
  | { id: TileId; seeAll: string; status: "ok"; kind: "todo"; summary: Summary }
  | { id: TileId; seeAll: string; status: "ok"; kind: "history"; history: History }
  | { id: "farmerLots"; seeAll: string; status: "ok"; kind: "counts"; counts: { pendingReview: number; live: number; soldOut: number } }
  | { id: TileId; seeAll: string; status: "error" };
export type OfficerHome = { verified: false } | { verified: true; tiles: Tile[]; schedule: DeliverySchedule | null };
export async function farmerHome(actor: Actor, now?: Date): Promise<Tile[]>;
export async function officerHome(actor: Actor, now?: Date): Promise<OfficerHome>;
export async function buyerHome(actor: Actor, now?: Date): Promise<Tile[]>;
export async function adminHome(actor: Actor, now?: Date): Promise<Tile[]>;
```

Each starts with `can(actor, "home:view")`, then requires its own role (`ForbiddenError` otherwise), then runs its summaries with `Promise.allSettled` in the spec's tile order (section 3). A rejected summary becomes `{ status: "error" }` and is logged as `console.error("home tile failed", { id })` with nothing else. `officerHome` returns `{ verified: false }` when the cooperative is not verified (read it the way `landing.ts`'s caller does) and calls no summaries; `schedule` is `null` when `deliverySchedule` failed.

- [ ] **Step 1: Failing tests:** `farmer_home_has_its_tiles_in_order`, the same for the other three roles; `a_failing_summary_becomes_an_error_tile_and_the_rest_load` (`vi.spyOn` one summary to reject); `refuses_another_roles_home`; `unverified_officer_gets_no_tiles` (Review Focus 3); `a_count_over_ninety_nine_reaches_the_tile` (101 pending farmers: the tile's `count` is 101, and `countLabel` gives "99+", Review Focus 5).
- [ ] **Step 2: Run, see them fail. Step 3: implement. Step 4: run, see them pass. Step 5: commit** `feat: the home module`.

---

### Task 8: The pages, the tile, and the two moved pages

**Files:**
- Create: `src/components/home/tile.tsx`, `src/components/home/schedule.tsx`, `src/app/officer/page.tsx`, `src/app/admin/page.tsx`, `src/app/farmer/profile/page.tsx`, `src/app/buyer/offers/page.tsx`
- Modify: `src/app/farmer/page.tsx`, `src/app/buyer/page.tsx`, `messages/*.json`
- Test: `tests/unit/home-copy.test.ts`

Steps:
- [ ] **Move first, unchanged:** today's `src/app/farmer/page.tsx` becomes `src/app/farmer/profile/page.tsx` (fix its sign-in `next` to `/farmer/profile`), and today's `src/app/buyer/page.tsx` becomes `src/app/buyer/offers/page.tsx`. Commit this move alone (`refactor: move the farm details and offer list to their own pages`) so the review sees a pure move.
- [ ] **The tile** (`tile.tsx`, server component): heading with the title and `countLabel(count)` for `todo` tiles; up to three `Link` rows in the list-page style (`press press-lift`, `rounded-inner`, `bg-paper`, `min-h-11`); `t("empty.<id>")` when there are none; `t("error")` with the See-all link for `status: "error"`; "See all" link. `farmerLots` shows three labelled numbers. Status codes are translated with the existing order and offer status keys. Long titles wrap (`break-words`, `min-w-0`).
- [ ] **The schedule** (`schedule.tsx`): "Overdue" group, one group per day (date formatted as the order pages do), the two closing lines, "No deliveries scheduled".
- [ ] **The officer, buyer and admin pages:** `requireActorForPage()`, role check with `notFound()` as `src/app/officer/orders/page.tsx:21` does, then the role's `*Home`.
- [ ] **The farmer page is different:** it must not call `requireActorForPage()`, which sends anyone without an actor to sign-in, and a pending or removed farmer has no actor. It reads the session itself (as today's `/farmer` does with `currentUser()`): signed out goes to sign-in with `next=/farmer`; signed in but `getActor()` null or not a FARMER goes to `/farmer/profile`; an active farmer gets `farmerHome`. The join page's links to `/farmer` rely on this. Heading `t("title", { name: firstName })` from `currentUser()`. Grid `grid gap-3 md:grid-cols-2`; schedule full width below. Each page body in `Suspense` with a skeleton, as other pages do. `/buyer` keeps its "Browse lots" `ButtonLink` to `/lots`. `/officer` with `verified: false` shows `t("officer.onboarding")` and a link to `/officer/onboarding`.
- [ ] **Copy:** `home` block in `messages/en.json`: `title` ("Home, {name}"), one `tiles.<id>` title and one `empty.<id>` line per tile, `seeAll`, `error` ("Couldn't load this"), `counts.pendingReview/live/soldOut`, `schedule.*`, `officer.onboarding` ("Finish onboarding to start selling"). Empty strings in the other locales. Unit test: every `TileId` has a title and an empty line; no `home` string says "escrow".
- [ ] **Run lint, typecheck, the unit tests; commit** `feat: role home pages`.

---

### Task 9: Landing, nav and links

**Files:**
- Modify: `src/modules/identity/landing.ts`, `src/components/nav-links.ts`, `src/modules/notifications/views.ts`, the files listed in spec section 4 ("Links into the moved pages"), `docs/architecture.md`
- Test: `tests/unit/landing.test.ts`, `tests/unit/nav-items.test.ts`, `tests/unit/header-nav.test.ts`, `tests/unit/notification-views.test.ts`, `tests/e2e/journey.ts`, `tests/e2e/name-changes.spec.ts`

- [ ] **Step 1: Update the tests first** to the new addresses: landing ADMIN `/admin`, OFFICER `/officer`, BUYER `/buyer`, FARMER `/farmer` (unchanged), unverified officer and BOARD_ADMIN unchanged; nav: a Home link first for the four roles, buyer "My offers" `/buyer/offers`, farmer "Your farm" `/farmer/profile`, the pending farmer's link `/farmer/profile`; `hrefOf("MEMBERSHIP_REMOVED", null, "m1") === "/farmer/profile"` and the same for the other membership and catalog-decision kinds; `LANDING` in `journey.ts`: admin `/\/admin$/`, officer `/\/officer$/`, buyer `/\/buyer$/`; `name-changes.spec.ts` opens `/farmer/profile`.
- [ ] **Step 2: Run the unit tests, see them fail.**
- [ ] **Step 3: Change the code**, including every revalidate and link in spec section 4. Search for `"/farmer"`, `'/farmer'`, `` `/farmer` ``, `"/buyer"` and `#crop-requests` with the `grep` subagent first and handle each hit as spec section 4 says.
- [ ] **Step 4: Add** the `home` module line to `docs/architecture.md`.
- [ ] **Step 5: Run the unit tests, see them pass; commit** `feat: land each role on its home page`.

---

### Task 10: End to end, click-through and the pull request

**Files:** Create `tests/e2e/home.spec.ts`.

- [ ] **Step 1: The spec** (model the set-up on `tests/e2e/marketplace.spec.ts` and the `journey.ts` helpers; scope locators to `getByRole("main")`):
  - `each role lands on its home after sign-in`: officer, buyer, farmer, admin (admin after two-factor).
  - `an officer's tile opens the item`: a buyer makes an offer; the officer's "Offers to answer" shows 1 and its row opens `/officer/offers/<id>`.
  - `a pending farmer is sent to the farm page`: a farmer who joined but is not approved opens `/farmer` and lands on `/farmer/profile`.
  - `a farmer using the buyer role is sent to the farm page`: an approved farmer who also holds a buyer membership switches to the buyer role and opens `/farmer`; they land on `/farmer/profile` and see their farm details (Review Focus 2).
  - `the buyer's offers have their own page`: `/buyer/offers` lists the offer.
- [ ] **Step 2: Run it, see it pass;** then the whole e2e suite once. Fix specs broken by the new addresses; report, without changing, any that fail for another reason.
- [ ] **Step 3: Click-through** (spec section 8): start `npm run dev` against the local database (create `.claude/launch.json` if missing), create local test accounts, and in the built-in browser pane open each of the four homes at 375×812 and 1280×800, once empty and once with items in every tile (seed with the integration fixtures or a short script). Include a 60-character cooperative name and a count over 99 (Review Focus 4 and 5). Screenshot each. Localhost only; never the public link.
- [ ] **Step 4:** lint, typecheck, `npm test`, `npx playwright test`; then the `audit` subagent on the committed branch; fix its findings.
- [ ] **Step 5:** push with `git push -u origin role-dashboards` and open the pull request against `main`: what was built; "No migration"; the spec section 10 choices plus any of yours; deviations from the plan; the click-through results (what each screenshot showed); which subagent ran each search and test run; how each Review Focus item turned out. Then stop. Do not merge.
