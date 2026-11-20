# Actor cache: one identity lookup per request

## Problem
PR #40 measured an officer home load at 89-112 statements, about half identity lookups (user 18,
membership 13, session 12). Within one request the root layout's `SwitcherSlot`, `AlertSlot`,
`NavSlot`, `AccountSlot`, `FooterSlot` and the page each call `auth.api.getSession()` and/or
`getActor()` (which also calls `listMemberships`). `/api/live` and `/api/alerts/summary` pay the same
per poll.

## Call sites (found by the `grep` subagent)
- `src/modules/identity/session.ts`: `getActor` (:12), `requireActor` (:32), `currentUser` (:38).
- `src/app/layout.tsx`: `auth.api.getSession` x4 (:39, :73, :101, :164), `getActor` x2 (:63, :108),
  `listMemberships` x3.
- Pages: `(auth)/require-actor-page.ts`, `lots/[id]`, `farmer`, `farmer/profile`.
- Route handlers: `api/live`, `api/alerts/summary`.
- Server actions: `actions/active-role.ts` (`setActiveRole`), `actions/landing.ts`, `buyer/actions.ts`.

## Approach
Wrap in `cache()` from `react` (not `'use cache'`). `'use cache'` is cross-request and would leak
identity between users; `cache()` is scoped to one server render / route-handler request and is
discarded afterwards. It does not interact with `cacheComponents: true` other than that dynamic
(`headers()`/`cookies()`) reads must stay inside Suspense, which they already do.

New helpers in `src/modules/identity/session.ts`:
- `getSessionCached()`: reads `cookies()` and uses the cookie string as the cache key into
  `cache((cookieKey) => auth.api.getSession({ headers: await headers() }))`.
- `listMembershipsCached(userId)`: `cache((userId, cookieKey) => listMemberships(userId))`.
- `getActor()` composes both; `currentUser()` uses the cached session.
- Layout slots (`SwitcherSlot`, `AccountSlot`, `NavSlot`, `FooterSlot`) switch to the cached helpers.
  `getActor`'s 2FA throw is not cached as a value, so each caller still sees the throw (a rejected
  promise from `cache()` is re-thrown to every caller; verify in a test).

### Key = serialized request cookies (`(await cookies()).toString()`)
A key of the full cookie string means a changed session token, a new `activeMembershipId`, or a
sign-out yields a different key and recomputes. Different users never share a key because the session
token is in it. Cookie writes made earlier in the same request (server action) are reflected, since
`cookies()` returns the mutated store.

### Server actions
`setActiveRole` sets the cookie, then the page refreshes. The refresh render happens after the
cookie write, so its key differs from any pre-write lookup and it recomputes. `setActiveRole` itself
keeps calling `auth.api.getSession` uncached (it is authorising a write). Sign-out: key changes with
the deleted cookie. Known limit: `auth.api.getSession` reads the original request `headers()`, not the
mutated store, so a same-request re-render after sign-in/out was already stale before this change; the
cache neither fixes nor worsens it.

## Not changing
Better Auth `cookieCache` stays off. No cross-request cache, no TTL cache, no change to `can()`.

## Tests (first, failing)
1. Unit: two `getActor()` in one request run session, membership queries once.
2. Unit: `getSessionCached` + `getActor` + `currentUser` together: one session query.
3. Different request (new `cache` scope / different cookies) recomputes; role cookie change within the
   request recomputes; two users never cross.
4. 2FA_REQUIRED still throws for every caller.
5. Existing `get-actor`, live-route, alerts-summary, require-actor-page tests stay green.

## Measure
Re-run PR #40's cost spec (`LIVE_COST=1`) on private `E2E_PORT` / `E2E_DATABASE_URL`; record before
and after statement counts for officer home, offer page, one `/api/live` poll in the PR.

## Choices where spec was silent
Key on the serialized cookie string rather than only the session cookie (simpler, safest).
