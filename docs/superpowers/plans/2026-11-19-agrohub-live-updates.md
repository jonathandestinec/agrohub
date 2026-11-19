# AgroHub Live Updates (Polling) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: PLAN ONLY. Nothing here is built. Build starts only after the orchestrator and then the user approve it, and from `main` after PRs #36, #37 and #38 land.**

**Goal:** A page that is open and visible updates by itself when another person acts (a new message, an order or offer changing status, a new alert, a new item in a queue), without a reload and without wasting a phone's data.

**Architecture:** One client loop per browser tab, mounted once in the root layout. Pages register "topics" with it (`alerts`, `thread:<id>`, `order:<id>`, …). Each tick sends one `POST /api/live` listing the topics that are due; the server answers each with a cheap version string (built from `updatedAt` / `lastMessageAt` / counts). When a version differs from the last one seen, the page calls `router.refresh()`. The bell also gets its small payload in the same response. The timing logic is a pure controller with an injected clock, so it is tested with fake timers and needs no new dependency.

**Tech Stack:** Next.js 16 (`cacheComponents: true`), React 19, Prisma 7 over `@prisma/adapter-pg` (Neon), Better Auth, Vitest, Playwright (`page.clock`). **No new dependency.**

**Spec:** No separate spec; this plan is the design. It lifts the deferral in `docs/superpowers/specs/2026-11-10-in-app-alerts-design.md` (line 27 "Live updates while a page is open"; lines 202-206 and 237 "no polling") and adds live behaviour to Phase 4 messaging. Also read `docs/superpowers/specs/2026-10-31-agrohub-design.md` §2 and `docs/architecture.md`.

## Decisions the user must make before build (the orchestrator will list these)

1. **Live chat is a launch non-goal** (main spec §2: "SMS or WhatsApp notifications, live chat"). An open thread polled every 5 s feels close to chat. This plan keeps it to polling with no typing indicators, no presence, no read receipts. Confirm that is acceptable.
2. **Is the production Neon URL the pooled one?** The repo cannot tell (`src/lib/db.ts` just reads `DATABASE_URL`). Polling raises connection churn; it must be the pooler URL. Check in the Vercel and Neon dashboards before build.
3. **Session cookie cache (optional, default OFF).** Every poll pays about 3 identity queries because `src/lib/auth.ts` has no `session.cookieCache`. Turning it on for 60 s cuts poll cost by roughly half, but a revoked session or removed membership stays valid up to 60 s. Not in the plan unless the user says yes (Task 9, optional).
4. **Clear the message alert when a thread is opened?** Today opening `/messages/[id]` does not clear its bell alert (only clicking the alert does). With live threads the bell will light up for a message already on screen. Not in this plan (it is a read that writes); say if you want it added as Task 10.

## Global Constraints

- Every service function takes an `Actor` and calls `can(actor, action, resource)` first; cooperative data is scoped by `cooperativeId` (CLAUDE.md). Version functions follow the same rule and **reuse the checks the page already uses** (`thread:participate`, `notification:own`, the order/offer read checks), so **no new `Action` value and no policy-matrix change**. If a task finds it needs one, it must add rows to `tests/access/policy-matrix.test.ts`.
- Business logic only in `src/modules/*/service.ts`; the route handler only parses, calls the service, maps errors.
- Private fields leave the server only through `views.ts` mappers. A version string is a hash-free join of timestamps and counts; it must never include floor price, phone, bank data or message text.
- Money is integer kobo; nothing here touches money arithmetic.
- User-facing copy never says "escrow" (no new copy is planned; any live-region text says "payment held until delivery is confirmed" if ever needed).
- No new dependency. If a task needs one it must add a line to `docs/architecture.md` §12 and be flagged in the PR. (jsdom/testing-library are deliberately avoided: see Task 1.)
- Test first, commit after every task; before each commit run `npm run lint`, `npm run typecheck`, `npm test` (via the `test` subagent). Searches via `search`/`grep`.
- E2E port comes from the configurable setting PR #36 adds; never hard-code 3100.
- Never merge your own PR; push the branch, open the PR, stop.

## Provenance of this plan's inventory (CLAUDE.md requires it)

| Search | Agent | Notes |
| --- | --- | --- |
| Orders, offers, lot screening map | `search` (1st run) | Ran on the **old tree** (before reset to `origin/main`). Facts about routes/services re-confirmed in the verify run below; the model/index facts are unchanged by later PRs but must be re-checked at build |
| Admin queues, test infra, layout, Vercel/DB | `search` (1st run) | **Old tree.** Dashboard claim ("not implemented") was wrong; superseded by the dashboards re-run. Test-infra and DB facts re-confirmed |
| Alerts and messaging | `search` (1st run, discarded as stale) then `search` (re-run on `origin/main` 08b84e2) | Re-run is the source |
| Dashboards | `search` re-run on `origin/main` 08b84e2 | Source for the dashboard rows |
| Paths, nav, e2e config, e2e helpers, architecture headings | `search` verify run on 08b84e2 | |
| `getActor` cost, raw SQL, `updatedAt` coverage, dispute/refund parent touches | `grep` on 08b84e2 | |

Every one of these agents reported it ran its searches with its own Read/Glob/Grep tools (it cannot spawn further agents); no search in this plan was done without going through a `search` or `grep` agent. I read `docs/architecture.md`, the first 120 lines of the main spec, and ran `git fetch`/`git reset --hard origin/main` (clean tree, nothing ahead of main) directly. The `audit` and `test` agents have not run yet (no code exists); `test` is used for the pre-commit checks on this document.

## Step 1: Inventory (what changes, who changes it, how stale today, how fresh it must be)

"Today" = only after the viewer's own action, a navigation, or (bell) a menu open / route change.

| # | Screen (route) | What another person changes | Who | Stale today | Needs | Topic |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Alert bell count + dropdown (`alert-bell.tsx`, layout `AlertSlot`) | new alert, read in another tab | any service via `notify()` | until navigation or menu open | 30 s | `alerts` |
| 2 | `/alerts` (`src/app/alerts/page.tsx`) | same alerts, newest first | same | until reload | 30 s (shares #1) | `alerts` |
| 3 | `/messages` inbox (`messages/page.tsx`) | new thread, new last message / ordering | buyer, officer, farmer, admin | until reload. **No unread markers exist** | 15 s | `threads` |
| 4 | Open thread `/messages/[id]` and the thread embedded in order and offer pages | new message | the other party | until reload (own post calls `router.refresh()`) | 5 s | `thread:<id>` |
| 5 | Buyer order detail `/buyer/orders/[id]` | payment confirmed (webhook), preparing, delivery date, delivered, refund, dispute, timed out | Paystack webhook, officer, admin, cron | until reload | 15 s; 5 s while `PENDING_PAYMENT` | `order:<id>` |
| 6 | Officer order detail `/officer/orders/[id]` | buyer cancel request, dispute, confirm receipt, payment | buyer, admin, webhook | until reload | 15 s | `order:<id>` |
| 7 | Order lists `/buyer/orders`, `/officer/orders` | any order status | as above | until reload | 30 s | `list:orders` |
| 8 | Buyer offer detail `/buyer/offers/[id]` | accepted, countered, declined, expired | officer, farmer, cron | until reload | 15 s | `offer:<id>` |
| 9 | Officer offer detail `/officer/offers/[id]`, farmer `lots/[id]` offer decision | new offer, buyer's counter response, withdrawn | buyer, officer, farmer | until reload | 15 s | `offer:<id>` |
| 10 | Offer lists `/buyer/offers`, `/officer/offers` | new/changed offers | as above | until reload | 30 s | `list:offers` |
| 11 | Officer lot screening `/officer/lots`, `/officer/lots/[id]` | new lot submitted, revision requested, farmer answers a counter | farmer | until reload | 30 s | `queue:screening` |
| 12 | Admin orders queue `/admin/orders` (disputes + payout issues + reconciliation issues) | new dispute, payout failed, issue raised | buyer, cron, webhook | until reload | 60 s | `queue:admin-orders` |
| 13 | Admin payouts `/admin/payouts` | failed/blocked/stale payouts | cron, Paystack | until reload | 60 s | `queue:payouts` |
| 14 | Admin lots to review `/admin/lots` | new lot with no other officer | farmer | until reload | 60 s | `queue:screening` |
| 15 | Admin cooperative verification `/admin/cooperatives` | new submission | officer | until reload | 60 s | `queue:verification` |
| 16 | Admin name changes `/admin/names` | new request | any user | until reload | 60 s | `queue:names` |
| 17 | Role home dashboards `/farmer`, `/buyer`, `/officer`, `/admin` (`src/modules/home`, built and merged in PR #23) | every tile | everyone | until navigation. Heavy: about 7 queries (farmer), 8 (buyer), 18 (verified officer), 12 + one per pending lot (admin, an existing N+1) | focus-only, plus refresh when the bell topic changes | none of their own |

Existing refresh code that stays: `router.refresh()` after the viewer's own action (about 30 call sites) and the bell's fetch on route change / menu open.

Facts the design depends on (all from the verify runs):
- `Order`, `Offer`, `Lot` have `@updatedAt`; every writer found (`updateMany` in `orders/*`, `marketplace/*`, `catalog/*`, `payments/payments.ts`) goes through Prisma, and no raw SQL writes these tables, so `updatedAt` is trustworthy. `Thread`, `Message`, `Dispute`, `Refund`, `LotRevision`, `Notification` have **no** `updatedAt`.
- Not every dispute/refund change touches the parent: an `AFTER_COMPLETION` dispute, `resolveDispute` outcome `NOTE`, and `catalog/revisions.ts` request/reject leave `Order.updatedAt`/`Lot.updatedAt` unchanged. So those versions must include child counts/max timestamps (see Task 3, 5).
- `notify()` collapses a repeat `MESSAGE_RECEIVED` into the existing unread row by setting its `createdAt` to now (`notifications/service.ts:124`): unread count stays the same while the content changes. A count alone is not a valid alerts version.
- `getActor()` is about 3 queries (session, user, memberships), uncached, with no `cookieCache` and no `React.cache()`. A typical page load runs about 15 identity round trips across layout slots and the page. A poll route runs one `getActor()`.
- The layout's phone menu "Alerts" link shows **no count**; the only count UI is `AlertBell` (badge `9+`). `NavSlot`'s `hasAlerts` only changes when the layout re-renders; it does not need to be live.
- `next.config.ts` sets `cacheComponents: true`; no `'use cache'` anywhere, so all authenticated pages are request-time. No middleware/proxy, no rate limiting in front of API routes, no `maxDuration`.

## Step 2: Design

### 2.1 Versions ("has anything changed?")

A version is a short string; the client only compares it for equality. Each is computed by a service function in the module that owns the data: `(actor, id?) => Promise<string>`.

| Topic | Version = | Queries |
| --- | --- | --- |
| `alerts` | `${unreadCount}:${max(createdAt) over visibleTo(actor)}`. Includes the collapse case because `createdAt` moves. Server also returns `{unread, alerts}` (the existing summary) **only when the client's `since` differs** | 2 (+1 when changed) |
| `thread:<id>` | `thread.lastMessageAt` ms (loads the thread with the same `participates` check as `loadThread`; non-participant gets the same not-found as a missing thread) | 1 |
| `threads` (inbox) | `${count}:${max(lastMessageAt)}` over `threadWhereFor(actor)` | 1 aggregate |
| `order:<id>` | `order.updatedAt` + embedded thread `lastMessageAt` + `${disputeCount}:${resolvedDisputeCount}` + `${refundCount}:${processedRefundCount}`; scoped by the same read check as `getOwnOrder` / `getCooperativeOrder` | about 3 |
| `offer:<id>` | `offer.updatedAt` + embedded thread `lastMessageAt` | about 2 |
| `list:orders` / `list:offers` | `${count}:${max(updatedAt)}` over the actor's scoped rows (buyer by `buyerUserId`, officer by `cooperativeId`) | 1 aggregate |
| `queue:screening` | lots `PENDING_REVIEW`/`LIVE` in scope: `${count}:${max(updatedAt)}` + pending `LotRevision` `${count}:${max(createdAt)}` (officer scoped by `cooperativeId`; admin unscoped). A superset of the real queue is fine: a false positive only costs one refresh. This deliberately avoids the per-lot `otherOfficerExists` N+1 | 2 |
| `queue:admin-orders` | open disputes `${count}:${max(createdAt)}` + unresolved reconciliation issues same + payout-issue query's aggregate | 3 |
| `queue:payouts` | payouts in `FAILED`/`BLOCKED`/`QUEUED`/`SENT`: `${count}:${max(updatedAt)}` (Task 6 confirms `Payout` has `updatedAt`; if not, count by status) | 1 |
| `queue:verification` | cooperatives `PENDING` with `submittedAt`: `${count}:${max(submittedAt)}` | 1 |
| `queue:names` | name changes `PENDING`: `${count}:${max(createdAt)}` | 1 |

No schema migration. If Task 3's tests show the dispute/refund children still miss a visible change, add `updatedAt` to that model in its own task rather than widening this one.

**Baseline without a missed change.** The page computes the version **before** it loads its data and passes it to the client as `initialVersion` (`<LiveTopic topic="order:ID" initialVersion={v} …/>`). Any change after that differs from the baseline, so nothing falls in the gap between render and first poll. A false positive (a change landing between version and data read) costs one extra refresh, never a missed one.

### 2.2 One request per tick, one loop per tab

- `POST /api/live` body `{ topics: [{ key: string, since?: string }] }`, at most 6 topics, keys matched against a closed pattern list (`alerts`, `threads`, `thread:<id>`, `order:<id>`, `offer:<id>`, `list:orders`, `list:offers`, `queue:<name>`), zod-validated, `Cache-Control: no-store`, `export const dynamic = "force-dynamic"`.
- Response `{ topics: { [key]: { version: string, data?: AlertSummary } | { error: "forbidden" | "not_found" } } }`. A bad topic never fails the others. No session → `401 {code:"UNAUTHENTICATED"}` (same as `/api/alerts/summary`).
- **Why one multiplexed request:** each request pays ~3 identity queries and a function invocation. A tab on an order page needs `alerts` (30 s) and `order:<id>` (15 s); sending them together on the 15 s tick means one auth, not two. The bell and the `/alerts` page share the single `alerts` topic (the page subscribes to it as a second listener), never two pollers.
- The route is a thin handler: `getActor()` → `readTopics(actor, topics)` in `src/modules/live/service.ts`, which only dispatches to each owning module's exported version function (a module imports another only through `service.ts`, per `docs/architecture.md` §2).

### 2.3 The client controller (pure, no jsdom)

`src/lib/live/controller.ts` exports `createLiveController({ send, now, setTimer, clearTimer, isVisible, isOnline, onChange, onStop })` and returns `{ subscribe(topic) → unsubscribe, setVisible(), setOnline(), kick() , dispose() }`. All time, visibility and network are injected, so Vitest in the existing `node` environment drives it with fake timers. `src/lib/live/live-provider.tsx` is a thin `"use client"` wrapper (window listeners, `fetch`, `router.refresh`) and `useLiveTopic(key, { intervalMs, initialVersion, onChange? })` is the hook pages use. The wrapper has no logic worth testing apart from the controller; it is covered by e2e only (stated plainly, not hidden).

Required behaviours (each has a controller unit test):
1. **Chained `setTimeout`, never `setInterval`**; the next timer is scheduled only after the previous request settles, so requests never overlap.
2. **Visibility:** hidden tab → clear timers and abort the in-flight request. Becoming visible, or window `focus`, triggers one immediate poll if the last success is older than `minGapMs` (default 10 s; 60 s for dashboard refresh), so rapid tab flipping cannot hammer the server.
3. **Offline:** `navigator.onLine === false` → no requests and no backoff growth; `online` event triggers one poll.
4. **Errors:** network error or 5xx → delay = `interval × 2^n`, ±20 % jitter, capped at 5 min; success resets. **401** → stop everything and call `router.refresh()` once (the server's `requireActorForPage` then redirects to sign-in). A per-topic `forbidden`/`not_found` (for example the role was switched in another tab) → stop that topic and call `router.refresh()` once so the server decides (404 or redirect).
5. **Quiet backoff for open threads:** after 6 consecutive unchanged polls, the thread topic goes 5 s → 10 s → 15 s; any change, send, focus or visibility return resets to 5 s.
6. **Slow connections:** if `navigator.connection.saveData` or `effectiveType` is `2g`/`slow-2g`, every interval is doubled.
7. **Per-topic cadence inside one loop:** the loop wakes at the earliest due topic and includes every topic that is due.
8. **On change:** default action is `startTransition(() => router.refresh())` (keeps the old UI on screen, no skeleton flash). The bell topic updates its own state from `data` and does not refresh the page.

### 2.4 Intervals, justified

Visible tab only. Hidden tabs poll nothing.

| Screen | Interval | Why |
| --- | --- | --- |
| Open thread | 5 s, backing off to 15 s | The only place a person is waiting on another person. Not chat (decision 1) |
| Order/offer detail | 15 s | A status change matters within seconds to a minute, not instantly. 5 s while a buyer's order is `PENDING_PAYMENT` (they have just come back from Paystack and are waiting for the webhook) |
| Bell, `/alerts` | 30 s | An alert is already a summary; the bell is on every page so it is the most-run poll |
| Inbox, lists, screening queue | 30 s (inbox 15 s) | Browsing screens; stale for half a minute is harmless |
| Admin queues | 60 s | Staff watch queues with a long working rhythm; items wait hours anyway |
| Dashboards | no timer. Refresh on focus (min gap 60 s) **and** when the `alerts` version changes (so the home page updates at zero extra requests when a person gets an alert). Tile changes that raise no alert update on focus or navigation only (named in Not in this plan) | 7 to 18+ queries per refresh is too heavy for a timer |

### 2.5 Cost, per active user (visible tab), without `cookieCache`

Identity ≈ 3 queries per request. Numbers are estimates from the query counts above, to be measured in Task 8 with `EXPLAIN` and a one-minute log; they are not benchmarks.

| Situation | Requests/min | DB queries/min | Data/min (≈1 KB per response incl. headers) |
| --- | --- | --- | --- |
| Buyer on an order page (alerts 30 s + order 15 s) | 4 | about 28 | about 4 KB |
| Same, order `PENDING_PAYMENT` (5 s) | 12 | about 80 (for the minutes after payment only) | about 12 KB |
| Open thread, first 30 s | 12 | about 52 | about 12 KB |
| Open thread after back-off (15 s) | 4 | about 19 | about 4 KB |
| Any page, bell only | 2 | about 10 | about 2 KB |
| Admin queue page (60 s + bell 30 s) | 2 | about 14 | about 2 KB |
| Dashboard, refresh on focus (once per 60 s at most) | bell 2 + one refresh | about 10 + about 25 per refresh | refresh is a full RSC payload (estimate 20 to 60 KB, unmeasured) |

Rough fleet figure: 100 users simultaneously on screen average about 20 queries/min each, so about 2,000 queries/min (about 33/s). One ordinary authenticated page load today costs about 25 to 40 queries, so an hour of one person's polling is worth about 30 to 45 page loads. The real costs are: (a) Neon compute never auto-suspends while anyone has a visible tab, which raises the compute bill; (b) the unpooled-connection risk (decision 2); (c) Vercel function invocations (plan limits not checked). If the user turns on `cookieCache`, auth drops from 3 queries to about 0 for most polls (cuts the figures above by roughly 40 to 60 %).

Safeguards: a cap of 6 topics per request and one poll in flight per tab (client). There is no server-side request limit: an in-process counter is unreliable on serverless, and a shared store is not planned (see Not in this plan, item 9).

## Review Focus (what the spec is silent about and a person would trip on)

1. **A half-typed reply or open form survives a refresh** while the other party's new message appears (`ReplyForm`, `QuoteForm`, checkout form, decision forms). Test in Task 5.
2. **No scroll jump or skeleton flash** when `router.refresh()` runs under `cacheComponents` + Suspense; a user scrolled up in a thread stays where they are. Test in Task 5 (e2e).
3. **Session expires, or the role is switched in another tab:** polls stop; one refresh; no error loop. Controller test (Task 1) + e2e (Task 8).
4. **Cross-cooperative probing:** an officer of cooperative B asking for `order:`/`thread:`/`offer:` of cooperative A gets the same `not_found` as a missing id; no version leaks. Integration test per module (Tasks 2 to 6).
5. **Phone sleeps for hours then wakes:** exactly one catch-up request, no burst; offline phone makes no requests and does not grow its backoff. Controller test (Task 1).
6. **A repeat message collapsed into one unread alert** changes the `alerts` version without changing the count. Integration test (Task 2).

## File structure

- Create `src/lib/live/controller.ts`: pure timing and state machine.
- Create `src/lib/live/live-provider.tsx`: `"use client"` provider, `useLiveTopic`, window listeners, `fetch`.
- Create `src/lib/live/topics.ts`: the closed topic-key grammar and zod schema shared by route and client.
- Create `src/modules/live/service.ts`: `readTopics(actor, requests)`. Dispatch only; no queries.
- Create `src/app/api/live/route.ts`: thin handler.
- Modify `src/modules/{notifications,messaging,orders,marketplace,catalog,payments,cooperatives,name-changes}/service.ts` (or their existing `reads.ts` re-exported through `service.ts`): add `*Version` functions.
- Modify `src/app/layout.tsx`: mount `LiveProvider` inside `NextIntlClientProvider` around the shell.
- Modify `src/components/alert-bell.tsx`, the page files in Step 1, and add `src/components/live-topic.tsx` (server-friendly wrapper that renders `<LiveTopic initialVersion=…>`).
- Tests: `tests/unit/live-controller.test.ts`, `tests/integration/live-*.test.ts`, `tests/e2e/live-updates.spec.ts`.

## Tasks

### Task 1: Pure poll controller

**Files:** Create `src/lib/live/controller.ts`, `src/lib/live/topics.ts`. Test: `tests/unit/live-controller.test.ts`.

**Interfaces:**
- Produces: `createLiveController(deps: { send(topics: {key; since?}[], signal: AbortSignal): Promise<LiveResponse>; now(): number; setTimer(fn, ms): TimerId; clearTimer(id): void; isVisible(): boolean; isOnline(): boolean; slow(): boolean; onChange(key, version, data?): void; onStop(key | "all", reason): void }): { subscribe(t: { key: string; intervalMs: number; initialVersion?: string; minGapMs?: number }): () => void; visibilityChanged(): void; onlineChanged(): void; kick(): void; dispose(): void }`.

- [ ] **Step 1: Write failing tests** (Vitest fake timers, injected fakes). Names and assertions: `does not overlap requests` (second tick never fires while `send` is pending); `pauses when hidden and aborts the in-flight request` (`signal.aborted === true`, no timers pending); `polls once on return to visible only when older than minGapMs`; `does nothing while offline and does not grow backoff`; `backs off 2x with jitter between 0.8 and 1.2 and caps at 300000 ms, resets on success`; `stops all and reports "unauthenticated" on 401`; `stops one topic on not_found/forbidden`; `thread topic slows 5s to 10s to 15s after 6 unchanged polls and resets on change`; `doubles intervals when slow()`; `wakes at the earliest due topic and sends only due topics`; `calls onChange only when version differs from the last seen`; `initialVersion prevents a false first change`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/live-controller.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `controller.ts` against the signature above; jitter takes an injected `random()` (default `Math.random`) so tests are deterministic. `topics.ts` exports `topicKeySchema` (zod) for the key grammar in 2.2.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: pure poll controller for live updates`.

### Task 2: Alerts version and the `/api/live` route

**Files:** Modify `src/modules/notifications/service.ts`; create `src/modules/live/service.ts`, `src/app/api/live/route.ts`. Test: `tests/integration/live-alerts.test.ts`, `tests/integration/live-route.test.ts` (follow `alerts-summary-route.test.ts`).

**Interfaces:**
- Produces: `alertsVersion(actor: Actor): Promise<string>`; `readTopics(actor: Actor, topics: {key: string; since?: string}[]): Promise<Record<string, {version: string; data?: AlertSummary} | {error: "forbidden" | "not_found"}>>`; route `POST /api/live`.

- [ ] **Step 1: Failing tests:** version changes when another service `notify()`s the user; unchanged when nothing happens; **changes on a repeat MESSAGE_RECEIVED collapse with the count unchanged** (Review Focus 6); changes when the alert is read in "another tab"; `data` is present only when `since` differs; user B never sees user A's alerts; route returns 401 without a session, 400 for a bad key or more than 6 topics, `Cache-Control: no-store`, and one bad topic does not fail the others.
- [ ] **Step 2: Run** `npx vitest run tests/integration/live-alerts.test.ts tests/integration/live-route.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `alertsVersion` using `visibleTo(actor)` + `requireOwn` (count + `max(createdAt)`); `readTopics` dispatches by key prefix and catches `ForbiddenError`/`NotFoundError` into `{error}`; the route is `getActor()` → `readTopics`, mapping `UnauthenticatedError`/`ForbiddenError` to 401 exactly like `src/app/api/alerts/summary/route.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: /api/live route and alerts version`.

### Task 3: Messaging versions (thread, inbox)

**Files:** Modify `src/modules/messaging/service.ts`; wire into `readTopics`. Test: `tests/integration/live-messaging.test.ts`.

**Interfaces:** Produces `threadVersion(actor, threadId): Promise<string>`, `inboxVersion(actor): Promise<string>`.

- [ ] **Step 1: Failing tests:** `threadVersion` changes after the other party posts, is unchanged otherwise; non-participant (other cooperative's officer, other buyer) gets `NotFoundError`, identical to a missing id; `inboxVersion` changes on a new thread's first message and on a new last message, scoped like `threadWhereFor` for BUYER, FARMER, OFFICER, ADMIN; system messages (`postSystemMessage`) also bump it.
- [ ] **Step 2: Run** `npx vitest run tests/integration/live-messaging.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** reusing `loadThread`/`participates` and `threadWhereFor`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: live versions for threads and inbox`.

### Task 4: Order and offer versions

**Files:** Modify `src/modules/orders/reads.ts` (exported via `service.ts`), `src/modules/marketplace/offers.ts`/`negotiation.ts`. Test: `tests/integration/live-orders-offers.test.ts`.

**Interfaces:** Produces `orderVersion(actor, orderId)`, `ordersListVersion(actor)`, `offerVersion(actor, offerId)`, `offersListVersion(actor)`.

- [ ] **Step 1: Failing tests:** `orderVersion` changes for each of: payment confirmed, preparing, delivery date set, delivered, receipt confirmed, buyer cancel request, refund, dispute opened, **dispute resolved with outcome NOTE** and **AFTER_COMPLETION dispute** (the two cases that do not touch `Order.updatedAt`), new thread message; unchanged otherwise. `offerVersion` changes on accept, counter, decline, expiry, new thread message. Lists change on any member change and not on other buyers'/cooperatives' orders. Cross-cooperative and cross-buyer id → `NotFoundError`. A buyer cannot read another buyer's order version.
- [ ] **Step 2: Run** `npx vitest run tests/integration/live-orders-offers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** each by running the same scoped read check as `getOwnOrder`/`getCooperativeOrder`/`getOwnOffer`/`getCooperativeOffer` and selecting only timestamps and child counts; no mapper output is reused, so no private field can leak.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: live versions for orders and offers`.

### Task 5: Client provider, bell, and thread/order/offer pages

**Files:** Create `src/lib/live/live-provider.tsx`, `src/components/live-topic.tsx`. Modify `src/app/layout.tsx` (inside `NextIntlClientProvider`), `src/components/alert-bell.tsx`, `src/app/alerts/page.tsx`, `src/app/messages/page.tsx`, `src/app/messages/[id]/page.tsx`, `src/app/buyer/orders/page.tsx`, `src/app/buyer/orders/[id]/page.tsx`, `src/app/officer/orders/page.tsx`, `src/app/officer/orders/[id]/page.tsx`, `src/app/buyer/offers/page.tsx`, `src/app/buyer/offers/[id]/page.tsx`, `src/app/officer/offers/page.tsx`, `src/app/officer/offers/[id]/page.tsx`, `src/app/farmer/lots/[id]/page.tsx`. Test: `tests/e2e/live-updates.spec.ts` (part 1).

**Interfaces:** Consumes Tasks 1 to 4. Produces `useLiveTopic(key, { intervalMs, initialVersion, minGapMs?, onChange? })` and `<LiveTopic topic intervalMs initialVersion />`.

- [ ] **Step 1: Failing e2e** (see Task 8's approach: two contexts via `newPage(browser)`, `setUpLotWorld`, `page.clock`): buyer's open order page shows "preparing" after the officer clicks start-preparing, **without reload**; open thread shows the officer's new message while the buyer's half-typed draft is still in the textarea (Review Focus 1); bell badge goes 0 to 1 on a phone viewport (375 px); `/alerts` list gains the row.
- [ ] **Step 2: Run** the spec (single worker, port from PR #36's setting). Expected: FAIL.
- [ ] **Step 3: Implement** the provider and wire pages. Each page computes its version before loading data and renders `<LiveTopic>`. `AlertBell` consumes the `alerts` topic's `data` for its state and keeps its route-change and menu-open fetches.
- [ ] **Step 4: Run.** Expected: PASS, plus the scroll/skeleton check from Review Focus 2.
- [ ] **Step 5: Commit** `feat: live updates for bell, threads, orders and offers`.

### Task 6: Screening and admin queue versions and wiring

**Files:** Modify `src/modules/catalog/screening.ts`, `src/modules/payments/admin.ts`, `src/modules/orders/disputes.ts` (queue aggregate), `src/modules/cooperatives/service.ts`, `src/modules/name-changes/service.ts`; wire pages `src/app/officer/lots/page.tsx`, `officer/lots/[id]`, `admin/lots`, `admin/orders`, `admin/payouts`, `admin/cooperatives`, `admin/names`. Test: `tests/integration/live-queues.test.ts`.

**Interfaces:** Produces `screeningVersion(actor)`, `adminOrdersQueueVersion(actor)`, `payoutsQueueVersion(actor)`, `verificationQueueVersion(actor)`, `nameQueueVersion(actor)`.

- [ ] **Step 1: Failing tests:** each version changes when an item enters or leaves its queue (new lot, **revision requested**, farmer answers a counter, new dispute, payout failed, new submission, new name change), is unchanged otherwise; officer of cooperative B sees no change from cooperative A's lot; non-admin gets `ForbiddenError` mapped to `forbidden` (reuse the page's existing `can` check). Confirm whether `Payout` has `updatedAt`; if not, the version uses count by status.
- [ ] **Step 2: Run** `npx vitest run tests/integration/live-queues.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** aggregates only (no per-row loops); wire pages.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: live updates for screening and admin queues`.

### Task 7: Dashboards

**Files:** Modify the four role home pages (`src/app/{farmer,buyer,officer,admin}/page.tsx`). Test: extend `tests/e2e/live-updates.spec.ts`.

- [ ] **Step 1: Failing e2e:** buyer's `/buyer` home tile "offers to act on" updates after the officer counters (this raises an alert, so it arrives via the alerts topic); returning focus after a quiet 60 s refreshes the home once; refocusing within 60 s does not.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `<LiveTopic>` variant with `topic="alerts"`, `refreshOnChange`, `minGapMs: 60000` and no timer of its own.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: dashboards refresh on focus and on new alerts`.

### Task 8: End-to-end proof, cost measurement, docs

**Files:** Complete `tests/e2e/live-updates.spec.ts`; modify `docs/architecture.md` (§2 notifications/`live` module line, new `/api/live` note), `docs/superpowers/specs/2026-11-10-in-app-alerts-design.md` (mark the deferral lifted).

- [ ] **Step 1: E2E scenarios**, two browser contexts via `newPage(browser)` (`tests/e2e/journey.ts`), world from `setUpLotWorld`, time advanced with Playwright's `page.clock.install()` before navigation and `page.clock.runFor(16000)` (so tests do not wait real seconds), **no `page.reload()` or `goto` after the action**: (a) officer posts, buyer's open thread updates; (b) officer starts preparing, buyer order page updates; (c) officer counters an offer, buyer offer page updates; (d) farmer submits a lot, officer's open screening queue gains it; (e) tab hidden (`visibilitychange` dispatched) makes zero `/api/live` requests, and visible again makes exactly one; (f) role switched in another tab, the open order page does not loop on errors. Run with `--workers=1`, never alongside integration tests.
- [ ] **Step 2: Run** the spec. Expected: PASS.
- [ ] **Step 3: Measure:** with query logging on the test database, record requests and queries for the Task 5 scenarios over one minute and paste the real numbers into the PR description next to the estimates in 2.5.
- [ ] **Step 4: Update** the two docs; no dependency line is needed.
- [ ] **Step 5: Run `npm run lint`, `npm run typecheck`, `npm test` and the e2e suite via `test`; commit** `docs: live updates architecture and e2e proof`. Open the PR; stop; do not merge.

### Task 9 (optional, only if the user answers yes to decision 3): Session cookie cache

Failing test that a removed membership is honoured within 60 s, not instantly; set `session.cookieCache` (`maxAge: 60`) in `src/lib/auth.ts`; measure the drop in poll queries. Own commit.

## Alternatives considered (one paragraph, as asked)

Server-Sent Events and a hosted realtime service (Pusher, Ably, Supabase Realtime) would deliver updates in under a second and cost less per idle user, but SSE needs a long-lived connection that Vercel serverless functions cut off at their duration limit (so it ends up reconnect-polling anyway), and a hosted service adds a vendor, a secret and a new place where cooperative-scoped authorization must be re-implemented. The user chose polling; this plan keeps the version endpoints behind one `readTopics` seam so a push channel could later replace the timer without touching the services.

## Not in this plan (said plainly, because a silent deferral hurt before)

What users will **not** get from this plan:

1. **No instant delivery.** The slowest update is up to 60 s on admin queues, 30 s on the bell, lists and screening, 15 s on order and offer pages, and 5 to 15 s in a thread. It is not real time, and not live chat (no typing indicator, no "online" dot, no read receipts).
2. **Hidden tabs get nothing.** A phone with the browser in the background, or another tab in front, receives no updates until the person comes back; then it refreshes once. No push notifications, SMS or WhatsApp (all launch non-goals).
3. **No unread markers in the inbox.** The brief mentions unread counts in `/messages`, but no per-thread read state exists (only the bell's `MESSAGE_RECEIVED` alert). The inbox will show new threads and new last messages live, but not "3 unread" per thread. Adding that needs a schema change and read tracking.
4. **The message alert is not cleared by opening the thread** (decision 4). With live threads the bell can show an unread message the person is already reading.
5. **Dashboard tiles that raise no alert update only on focus or navigation,** not while you stare at the page. Tiles fed by the alerts topic update within 30 s.
6. **Screens not in the brief's list and not made live:** farmer lot list and lot detail except the offer decision (row 9), farmer earnings, officer farmers list and catalog requests, officer onboarding, admin cooperative detail, admin names detail and settings, board admin pages, the receipt page, the public `/lots`, `/prices`, `/cooperatives` pages, and `/account`. They update on reload or navigation as today.
7. **No live "typing while the other side is editing" conflicts:** two officers on the same offer can still both press a button; the second gets the existing error. The page will usually have updated first, but it is not guaranteed.
8. **Existing defects found and left alone (follow-ups, not fixes):** the admin lots tile runs a per-lot `membership.count` (unbounded N+1); no server action revalidates `/officer` or `/admin` home; the farmer earnings tile loads up to 100 statements to show 3; no rate limit sits in front of `/api/live`; `NavSlot`'s `hasAlerts` is not live.
9. **No server-side polling limit.** Serverless gives no reliable in-process counter; a misbehaving client could call `/api/live` often. Mitigated by the 6-topic cap, the client's single-flight loop and browser behaviour only. A proper limit needs a shared store (database or Redis); not planned.
10. **Cost is real and not capped:** Neon compute stays awake while anyone has a visible tab; the figures in 2.5 are estimates until Task 8 measures them; the pooled-URL question (decision 2) is unresolved.

## Self-review

- Spec coverage: every screen the brief named has a row in Step 1 and a task; deferrals are in the last section.
- Type consistency: `readTopics`, `*Version(actor, id?)`, `useLiveTopic`, `<LiveTopic>` and the topic grammar are named once and reused unchanged.
- Proportion: code appears only as signatures; test names carry the assertions.
