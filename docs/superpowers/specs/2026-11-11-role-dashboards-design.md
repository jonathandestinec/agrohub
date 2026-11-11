# Role home dashboards: design

Date: 2026-11-11. Status: agreed in conversation, awaiting review of this file.

## 1. Purpose

Each person lands, after sign-in, on a home page that shows what is waiting for them and links to where they deal with it. Today officers and admins land on their orders page, buyers on the lot listing, and farmers on a page that only shows their membership, so the first screen does not tell anyone what to do next.

This implements spec section 6.14 (`docs/superpowers/specs/2026-10-31-agrohub-design.md`) and roadmap item 6.3, including the officer's list of upcoming deliveries by date.

## 2. Scope

In this stage:

- A home page for farmer, officer, buyer and admin, made of to-do tiles.
- Each role lands on its home after sign-in, and its nav starts with a Home link.
- Two existing pages move to make room (section 4).
- The officer's upcoming deliveries for the next 14 days.

Not in this stage:

- Farmer analytics (roadmap 6.1) and admin reports.
- Input orders: not built yet.
- Unread markers on messages: threads have no unread state, and the alerts bell already reports new messages.
- Any change to the board admin, who keeps landing on `/board` (spec 6.14 already makes price entry their home).
- New actions on the home pages. Every action stays on the page that already has it.

## 3. The tiles

There are two kinds of tile:

- **To-do tiles** show a count, the three **oldest** items (they have waited longest), each linking to that item, and a "See all" link to the full page that already exists.
- **History tiles** (recent earnings, recent receipts, messages) show the three **newest** items and "See all", with no count.

A tile with nothing in it stays in place and says so in one line ("No lots to screen"), so the page keeps its shape.

Where a tile below says "as `someList`", its summary uses that list function's filter and permission check, without the list's row cap, so its count is the number of rows that list would show. Every other tile is a named subset of the page it links to: "See all" shows more than the tile counts.

### 3.1 Farmer (`/farmer`)

| Tile | What it counts | Items | See all |
|---|---|---|---|
| Offers waiting on you | Offers in `AWAITING_FARMER` on the farmer's own lots, not expired, lot publicly visible (as `listOffersAwaitingFarmer`) | oldest | `/farmer/lots` |
| Lots needing your answer | Own lots in `COUNTERED` | oldest | `/farmer/lots` |
| Your lots | Own lots by status: `PENDING_REVIEW`, `LIVE`, `SOLD_OUT` (three numbers, no items) | none | `/farmer/lots` |
| Recent earnings | Completed orders on lots the farmer contributed to (as `listOwnEarnings`) | newest | `/farmer/earnings` |
| Messages | The farmer's threads (as `listOwnThreads`) | newest by last message | `/messages` |

### 3.2 Officer (`/officer`, new)

| Tile | What it counts | Items | See all |
|---|---|---|---|
| Farmers to approve | `PENDING` memberships of the cooperative (as `listPendingFarmers`) | oldest | `/officer/farmers` |
| Lots to screen | As `listScreeningQueue` for an officer: `PENDING_REVIEW` or `COUNTERED`, or `LIVE` with a pending revision | oldest | `/officer/lots` |
| Offers to answer | The cooperative's offers in `OPEN`, not expired | oldest | `/officer/offers` |
| Orders to prepare | The cooperative's orders in `PAID_HELD` with no cancel request | oldest by `paidAt` | `/officer/orders` |
| Needs attention | The cooperative's orders that are `DISPUTED` or `TIMED_OUT`, or have a cancel request | oldest | `/officer/orders` |
| Crop and unit requests | Requests in `WITH_OFFICER` (as `listCooperativeCatalogRequests`) | oldest | `/officer/farmers` |
| Messages | The cooperative's threads | newest | `/messages` |

**Delivery schedule**, full width under the tiles, for the cooperative's orders in `PAID_HELD` or `PREPARING` without a cancel request:

1. **Overdue** first: a `deliveryDate` before today in Lagos time, oldest first.
2. **The next 14 days**: a `deliveryDate` from today to today plus 13 days, grouped by date, earliest first.
3. Two closing lines with counts, each linking to `/officer/orders`: "N with no date set" and "N later than two weeks".

Each row shows the quantity, unit, crop and buyer name, and links to `/officer/orders/[id]`. Up to 50 rows across the overdue and 14-day groups; past that, a line says how many more there are. With nothing in any group, it says "No deliveries scheduled".

**Where every open order shows on the officer home:**

| Order | Shown in |
|---|---|
| `PAID_HELD`, no cancel request | Orders to prepare, and the schedule if it has a date |
| `PREPARING`, no cancel request | The schedule: overdue, a day in the next 14, or a closing line |
| `PAID_HELD` or `PREPARING` with a cancel request | Needs attention |
| `DISPUTED` or `TIMED_OUT` | Needs attention |
| `DELIVERED_MARKED` | Nowhere on the home page: it waits on the buyer, not the officer. It stays on `/officer/orders` |

An officer whose cooperative is not verified still lands on `/officer/onboarding`. If they open `/officer` anyway, the page shows one message instead of tiles, "Finish onboarding to start selling", with a link to onboarding.

### 3.3 Buyer (`/buyer`)

| Tile | What it counts | Items | See all |
|---|---|---|---|
| Offers to act on | Own offers `ACCEPTED` and not yet ordered with `payByAt` in the future (pay now), and own offers `COUNTERED` (answer the counter) | oldest; an accepted offer shows its pay-by date | `/buyer/offers` |
| Deliveries to confirm | Own orders in `DELIVERED_MARKED` | oldest | `/buyer/orders` |
| Orders in progress | Own orders in `PENDING_PAYMENT`, `PAID_HELD`, `PREPARING`, `DISPUTED` or `TIMED_OUT` | oldest; each shows its status and delivery date | `/buyer/orders` |
| Recent receipts | Own orders in `COMPLETED` | newest | `/buyer/orders` |
| Messages | The buyer's threads | newest | `/messages` |

The page also keeps a "Browse lots" button to `/lots`, as `/buyer` has today.

### 3.4 Admin (`/admin`, new)

| Tile | What it counts | Items | See all |
|---|---|---|---|
| Cooperatives to verify | As `listVerificationQueue` | oldest | `/admin/cooperatives` |
| Reported problems | `OPEN` disputes | oldest | `/admin/orders` |
| Payout problems | As `listPayoutIssues` | oldest | `/admin/payouts` |
| Reconciliation issues | Unresolved, as `listReconciliationIssues` | oldest | `/admin/orders` |
| Name changes | As `listNameChangeQueue` | oldest | `/admin/names` |
| Lots to review | As `listScreeningQueue` for an admin (the read behind `/admin/lots`) | oldest | `/admin/lots` |
| Messages | Threads, as `listOwnThreads` for an admin | newest | `/messages` |

Items show the crop, quantity and unit, a person's or cooperative's name where the list page already shows it, and a date. No tile shows floor prices, phone numbers or bank data. The only money shown is a person's own: the farmer's earnings tile shows each statement's amount to the farmer, and the buyer's receipts tile shows each order's total, both through the views those pages already use. No officer or admin tile shows an amount.

## 4. Pages and navigation

| Role | Home | Page that moves | Its new address |
|---|---|---|---|
| Farmer | `/farmer` | Membership, farm details, bank, crop requests, leave (today's `/farmer`) | `/farmer/profile` |
| Officer | `/officer` (new) | none | |
| Buyer | `/buyer` | The offer list (today's `/buyer`) | `/buyer/offers`, a new page beside the existing detail pages at `/buyer/offers/[id]` |
| Admin | `/admin` (new) | none | |
| Board admin | `/board` (unchanged) | none | |

- **Landing** (`src/modules/identity/landing.ts`): ADMIN to `/admin`, OFFICER to `/officer` when verified (else `/officer/onboarding`, unchanged), FARMER to `/farmer`, BUYER to `/buyer`, BOARD_ADMIN unchanged. An explicit safe `next` still wins.
- **Nav** (`src/components/nav-links.ts`): each of the four roles gets a Home link first. The buyer's "My offers" points to `/buyer/offers`. The farmer gets "Your farm" (`/farmer/profile`). The nav for a person with no active membership keeps its current links, with the pending farmer's link moved to `/farmer/profile`.
- **`/farmer` without an active farmer role** (a pending or removed farmer, or someone with no farmer membership) redirects to `/farmer/profile`, which shows their status as `/farmer` does today.
- **Links into the moved pages** are updated wherever the code points at the moved content. Found by search on 2026-11-11:
  - The farmer's server actions in `src/app/farmer/actions.ts` and `src/app/officer/actions.ts` revalidate `/farmer`: they also revalidate `/farmer/profile`.
  - `src/app/farmer/lots/new/lot-form.tsx` links to `/farmer#crop-requests` and `src/app/farmer/lots/new/page.tsx` to `/farmer` for the profile: both point to `/farmer/profile`.
  - The offer actions in `src/app/buyer/actions.ts`, `src/app/officer/offers/actions.ts` and `src/app/farmer/lots/actions.ts` revalidate `/buyer`: they also revalidate `/buyer/offers`.
  - Links that mean "go home" stay as they are: the join page's links to `/farmer` and the buyer sign-up's `router.push("/buyer")`.
  - Tests that assert the old addresses: `tests/unit/landing.test.ts`, `tests/unit/nav-items.test.ts`, `tests/unit/header-nav.test.ts`, `tests/unit/notification-views.test.ts`, `tests/e2e/journey.ts` (`LANDING`), and `tests/e2e/name-changes.spec.ts`, which opens `/farmer` for the farm details.
- **Alert links** (`src/modules/notifications/views.ts`): the `MEMBERSHIP_*` and `CATALOG_REQUEST_APPROVED` / `CATALOG_REQUEST_DECLINED` kinds open `/farmer/profile`.

## 5. Data

No new table, no migration, no new dependency.

**Summary functions.** Each area gets a read function in its own module, exported through that module's `service.ts`:

```ts
// src/lib/summary.ts
export type TileItem = { id: string; href: string; title: string; detail?: string; date?: string; label?: string };
export type Summary = { count: number; items: TileItem[] }; // to-do tiles: count and the oldest 3
export type History = { items: TileItem[] };                // history tiles: the newest 3
```

`title` and `detail` hold data only (quantities, names, an amount already formatted). Any words come through `label`, a message key, so the tile never prints a status code.

| Module | Functions |
|---|---|
| `marketplace` | `farmerOffersSummary`, `officerOffersSummary`, `buyerOffersToActSummary` |
| `catalog` | `farmerCounteredLotsSummary`, `farmerLotCounts`, `screeningSummary`, `catalogRequestsSummary` |
| `farmers` | `pendingFarmersSummary` |
| `orders` | `recentEarningsSummary`, `ordersToPrepareSummary`, `officerAttentionSummary`, `deliverySchedule`, `deliveriesToConfirmSummary`, `buyerOpenOrdersSummary`, `recentReceiptsSummary`, `openDisputesSummary` |
| `payments` | `payoutIssuesSummary`, `reconciliationSummary` |
| `cooperatives` | `verificationSummary` |
| `name-changes` | `nameChangeQueueSummary` |
| `messaging` | `latestThreads` |

- Each takes an `Actor` (and `now` where time matters) and checks the same `can` action as its list counterpart before reading. Cooperative reads are scoped by `actor.cooperativeId`.
- Counts are `count` queries. Items are a `findMany` with `take: 3`. No summary loads a full list.
- Items are built by each module's `views.ts`, which selects only the fields an item shows, so private fields cannot reach the page.
- `deliverySchedule(actor, now)` returns `{ overdue: DeliveryRow[]; days: { date: string; orders: DeliveryRow[] }[]; more: number; noDate: number; later: number }`, using `src/lib/lagos-date.ts` for the window and the grouping.

**The `home` module** (`src/modules/home/service.ts`) assembles each role's page: `farmerHome(actor, now)`, `officerHome(actor, now)`, `buyerHome(actor, now)`, `adminHome(actor, now)`. Each first checks `can(actor, "home:view")`, a new action allowed for FARMER, OFFICER, BUYER and ADMIN, and then requires its own role, throwing `ForbiddenError` otherwise. It then calls its summaries in parallel with `Promise.allSettled` and returns the tiles in a fixed order as `{ id, status: "ok", summary } | { id, status: "error" }`. It holds no queries of its own; each summary still runs its own `can` check.

**Copy** lives in `messages/en.json` under `home`. The other locale files get the same keys as empty strings, as the i18n test requires.

## 6. Interface

- A page heading ("Home" plus the person's first name), then a grid of tiles: one column on phones, two from `md` up. The officer's upcoming deliveries span the full width below the tiles.
- One new component, `src/components/home/tile.tsx`: title, count, up to three item links, the empty line, and "See all". Item rows use the same link style the list pages use today (`press press-lift`, `rounded-inner`, `bg-paper`, at least 44px tall). It is built from the kit (`Card`, `Chip`, `ButtonLink`).
- Counts above 99 show "99+".
- Each page loads behind `Suspense` with a skeleton of the tile grid, as other pages do.
- The pages call only the `home` service; they hold no queries.

## 7. Errors

- If one summary fails, its tile shows "Couldn't load this" with its "See all" link, and the rest of the page renders. The failure is logged with the tile id only.
- A summary that the actor is not allowed to read is never called, because each `*Home` function asks only for its own role's tiles.
- `/officer`, `/buyer`, `/buyer/offers` and `/admin` opened by someone without that role go through `requireActorForPage` and then call `notFound()`, the pattern every role page uses today (for example `src/app/officer/orders/page.tsx:21`). `/farmer` redirects as section 4 says.

## 8. Tests

- **Unit** (`tests/unit`): the schedule's overdue group, 14-day window and closing lines in Lagos time, including a delivery dated the last day of the window and one dated the day after; the "99+" count; each role's tile order.
- **Integration** (`tests/integration`): each summary counts the right rows, returns at most three items in the right order, and leaves out other cooperatives' and other people's rows. For the tiles marked "as `someList`", the count equals the length of that list for the same data (kept under the list's cap). Every open order status in section 3.2's table lands where the table says.
- **Access** (`tests/access`): every summary refuses a role that its list counterpart refuses, and an officer of another cooperative.
- **Error:** one failing summary leaves the other tiles rendered (a `home` service test with one summary made to throw).
- **End to end:** each of the four roles lands on its home after sign-in; a tile item link opens its page; `/farmer` sends a pending farmer to `/farmer/profile`; `/buyer/offers` lists the buyer's offers. The `LANDING` constants in `tests/e2e/journey.ts` and `tests/unit/landing.test.ts` are updated, and every spec that relies on them still passes.
- **Click-through:** on a local dev server with local test accounts, each home page at 375px and 1280px wide, empty and with items in every tile, screenshots recorded in the pull request.

## 9. Rollout

- One pull request from its own branch and worktree, built by a Sonnet session (no money path is touched).
- No migration, so nothing to apply to staging before the merge.
- `docs/architecture.md` gains a line for the `home` module.

## 10. Choices made where the spec was silent

1. To-do tiles that link to the existing pages, not new lists with actions.
2. Three items per tile: oldest for waiting work, newest for history.
3. A delivery schedule with an overdue group, a 14-day window and counts for undated and later orders, capped at 50 rows.
7. History tiles (earnings, receipts, messages) have no count; a person's own earnings and receipts show their amounts.
8. A new `home:view` policy action for the four roles with a home page.
4. Today's `/farmer` content moves to `/farmer/profile`, and the buyer's offer list to `/buyer/offers`.
5. No analytics, reports, input orders or message unread markers in this stage.
6. A failed tile shows an error in place instead of failing the page.
