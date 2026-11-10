# In-App Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save an alert for each person an event concerns, and show them in a header bell and an `/alerts` page.

**Architecture:** A `notification` table and a `notifications` service with one write function, `notify`, called by the existing services at the moment a state change is saved. Reads go through actor-checked service functions and a `views.ts` mapper that returns a kind, display params and a link; the sentence for each kind lives in `messages/en.json`. The bell is a client component fed by a layout slot for first paint and by `GET /api/alerts/summary` on navigation.

**Tech Stack:** Next.js 16.4.3 (App Router), React 19.3, Prisma 7 on PostgreSQL, next-intl, Vitest (projects `unit`, `access`, `integration`), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-in-app-alerts-design.md`. Read it with this plan; section numbers below refer to it.

## Global Constraints

- Money is integer kobo. All arithmetic and formatting go through `src/lib/money.ts`. No floats.
- Business logic lives only in `src/modules/*/service.ts` (and the files a barrel `service.ts` re-exports). Components, actions and route handlers call services.
- Every service function that takes an `Actor` checks `can(actor, action, resource)` first.
- Private fields (floor price, phone numbers, bank data) never enter `Notification.data` and leave the server only through `views.ts`.
- User-facing copy never says "escrow". Say "payment held until delivery is confirmed".
- No new dependency. No new environment variable. No new scheduled job.
- Test first: failing test, watch it fail, implement, watch it pass, commit. One commit per task at least.
- Before each commit: `npm run lint`, `npm run typecheck`, `npm test`. Delegate test runs and repo searches to the `test`, `search` and `grep` subagents, and record in the pull request which subagent ran each.
- No Co-Authored-By trailers and no "Generated with Claude Code" lines.
- Where this plan and the spec are silent, take the simpler option, say so in the commit message, and list it in the pull request description.
- Never merge the pull request. Push, open it, stop.
- Test names are snake_case sentences (`approves_a_personal_name_change`).
- An alert is written only on the branch where the state really changed: where a conditional `updateMany` returned `count === 1`, or inside the transaction that created the row (spec section 3, rule 6).
- The acting user is never a recipient: pass their id as `exclude`.

## Review Focus

1. **A person with no active membership** (a farmer just rejected or removed, with no other role). `getActor` returns null for them, so they have no bell and `/alerts` sends them to sign-in; the existing email is what tells them. Their alert row must still be written, and must show as soon as they hold any role. Test in Task 9. `/alerts` must redirect, not error, for them. Test in Task 12.
2. **A BigInt amount in `data`.** `Payout.amountKobo` and `Refund.amountKobo` are BigInt and cannot be stored in a Json column. `data` carries them as decimal strings and the view formats them. Test in Task 2.
3. **An alert whose subject has moved on** (offer expired, order completed, lot withdrawn). Opening it must land on a page that renders, not a 404 or an error. Test in Task 12.
4. **A bad `?page=`** on `/alerts` (`abc`, `0`, `-3`, a page past the end). It should show the nearest valid page. Test in Task 4.
5. **A cooperative whose only officer is the actor**, or no active admin at all. `notify` writes nothing and the change still succeeds. Test in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/*_notifications/` | `Notification` model, `NotificationKind`, `NotificationSubjectType` |
| `src/modules/identity/policies.ts` | new action `notification:own` |
| `src/modules/notifications/schema.ts` | kinds, the `data` shape per kind, zod parsers |
| `src/modules/notifications/recipients.ts` | who to tell: recipient list helpers |
| `src/modules/notifications/service.ts` | `notify` and the actor-checked read and mark functions |
| `src/modules/notifications/views.ts` | row to `AlertView`: params and link |
| `messages/en.json` (`alerts`) | one sentence per kind, bell and page labels |
| `src/app/api/alerts/summary/route.ts` | count and ten newest for the bell |
| `src/app/alerts/page.tsx`, `src/app/alerts/actions.ts` | full list, open and mark-all actions |
| `src/components/alert-bell.tsx`, `src/components/alert-list.tsx` | bell and the shared list rows |
| `src/components/app-nav.tsx`, `src/components/ui/menu.tsx`, `src/app/layout.tsx` | bell visible on phones, `onOpen` on the menu, `AlertSlot` |
| existing services (Tasks 5 to 10) | one `notify` call per event |
| `tests/integration/alert-helpers.ts` | `alertsFor` and `alertKinds` test helpers |

---

### Task 1: Table, enums and the `notification:own` policy

**Files:**
- Modify: `prisma/schema.prisma` (new model after `ReconciliationIssue`; `notifications Notification[]` on `User` after `orders Order[]`)
- Create: `prisma/migrations/<timestamp>_notifications/migration.sql` (generated)
- Modify: `src/modules/identity/policies.ts` (`Action` union, `can` switch)
- Modify: `tests/integration/helpers.ts` (`cleanDatabase`: delete `notification` before `user`)
- Test: `tests/access/policy-matrix.test.ts`

**Interfaces:**
- Produces: Prisma `Notification` model exactly as in spec section 5; enum `NotificationKind` with every kind in the Task 2 table; enum `NotificationSubjectType` = `LOT | OFFER | ORDER | THREAD | COOPERATIVE | MEMBERSHIP | NAME_CHANGE | CATALOG_REQUEST | BANK_CHANGE`; action `"notification:own"`.

- [ ] **Step 1: Write the failing policy tests**

In `tests/access/policy-matrix.test.ts`, next to the existing `earnings:own` owner tests:

```ts
describe("notification:own", () => {
  it.each(["FARMER", "OFFICER", "BUYER", "ADMIN", "BOARD_ADMIN"] as const)(
    "allows_%s_to_read_their_own_alerts",
    (role) => {
      expect(can(actor(role, COOP), "notification:own", { ownerUserId: "user-1" })).toBe(true);
    },
  );
  it("denies_another_persons_alerts", () => {
    expect(can(actor("ADMIN"), "notification:own", { ownerUserId: "someone-else" })).toBe(false);
  });
  it("denies_when_no_owner_is_given", () => {
    expect(can(actor("BUYER"), "notification:own")).toBe(false);
  });
});
```

If the matrix has a completeness check that every `Action` appears in the table, add the five `["notification:own", role, false]` rows it needs (the matrix resource has a different owner, so all five are `false`).

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/access/policy-matrix.test.ts`
Expected: FAIL, `"notification:own"` is not assignable to `Action`.

- [ ] **Step 3: Add the action**

`"notification:own"` in the `Action` union; in `can`: any role, `resource?.ownerUserId !== undefined && resource.ownerUserId === actor.userId`.

- [ ] **Step 4: Add the model and migrate**

Add the model and two enums from spec section 5 (`role Role?`, `cooperativeId String?`, `data Json`, the three indexes, `@@map("notification")`).

Run: `npm run db:migrate -- --name notifications` then `npx prisma generate`
Expected: one new migration folder ending `_notifications`; `src/generated/prisma` has `Notification`.

- [ ] **Step 5: Add `notification` to `cleanDatabase`** in `tests/integration/helpers.ts`, before the `user` delete.

- [ ] **Step 6: Run and commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all pass.

```bash
git add prisma src/modules/identity/policies.ts tests/access/policy-matrix.test.ts tests/integration/helpers.ts
git commit -m "feat: notification table and the notification:own policy"
```

---

### Task 2: Kinds, data shapes, the view mapper and the copy

**Files:**
- Create: `src/modules/notifications/schema.ts`, `src/modules/notifications/views.ts`
- Modify: `messages/en.json` (new top-level `alerts`)
- Test: `tests/unit/notification-views.test.ts`

**Interfaces:**
- Produces:

```ts
// schema.ts
export type AlertKind = NotificationKind;                    // from the generated Prisma client
export type AlertData = { [K in AlertKind]: z.infer<(typeof DATA)[K]> };
export const DATA = { /* one strict zod object per kind */ } satisfies Record<AlertKind, z.ZodType>;  // `satisfies`, so each kind keeps its own shape and `notify` type-checks `data`
export const ALERT_KINDS: readonly AlertKind[];

// views.ts
export type AlertView = {
  id: string;
  kind: AlertKind;
  params: Record<string, string | number>;
  malformed: boolean;  // stored data failed its kind's parser: show alerts.fallback
  href: string;
  read: boolean;
  createdAt: string; // ISO
};
export function toAlertView(row: Notification): AlertView;
export function hrefOf(kind: AlertKind, role: Role | null, subjectId: string): string;
```

**The kinds.** `data` shapes (all `z.object({...}).strict()`):

- `LOT` = `{ crop: string }`
- `QTY` = `{ crop: string; quantity: number; unit: string }`
- `QTY_DATE` = `QTY` plus `{ date: string }` (`YYYY-MM-DD`)
- `MONEY` = `{ crop: string; amountKobo: string }` (decimal digits only, `/^\d+$/`)
- `COOP` = `{ cooperative: string }`
- `PERSON` = `{ name: string }`
- `ITEM` = `{ itemKind: "CROP" | "UNIT"; name: string }`
- `DATE` = `{ date: string }`
- `PROBLEM` = `{ problem: "FAILED" | "BLOCKED" | "NO_FUNDS" | "STALE" | "RECONCILIATION" | "REFUND_FAILED" }`
- `NONE` = `{}`

| Kind | Subject type | Data | Link |
|---|---|---|---|
| `LOT_APPROVED`, `LOT_REJECTED`, `LOT_COUNTERED`, `LOT_REVISION_DECIDED` | LOT | LOT | `/farmer/lots/{id}` |
| `OFFER_NEEDS_FARMER` | LOT | QTY | `/farmer/lots/{id}` |
| `LOT_ORDER_PAID` | ORDER | QTY | `/farmer/earnings/{id}` |
| `PAYOUT_SENT` | ORDER | MONEY | FARMER: `/farmer/earnings/{id}`; OFFICER: `/officer/orders/{id}` |
| `MEMBERSHIP_APPROVED`, `MEMBERSHIP_REJECTED`, `MEMBERSHIP_REMOVED` | MEMBERSHIP | COOP | `/farmer` |
| `BANK_CHANGE_APPLIED` | BANK_CHANGE | NONE | `/account` |
| `NAME_CHANGE_APPROVED`, `NAME_CHANGE_REJECTED` | NAME_CHANGE | NONE | `/account` |
| `CATALOG_REQUEST_APPROVED`, `CATALOG_REQUEST_DECLINED` | CATALOG_REQUEST | ITEM | `/farmer` |
| `FARMER_ASKED_TO_JOIN`, `FARMER_LEFT` | MEMBERSHIP | PERSON | `/officer/farmers` |
| `LOT_SUBMITTED`, `LOT_REVISION_REQUESTED`, `LOT_COUNTER_ANSWERED`, `LOT_WITHDRAWN` | LOT | LOT | `/officer/lots/{id}` |
| `CATALOG_REQUEST_MADE` | CATALOG_REQUEST | ITEM | `/officer/lots` |
| `OFFER_RECEIVED`, `OFFER_COUNTER_ANSWERED`, `OFFER_FARMER_ANSWERED`, `OFFER_WITHDRAWN` | OFFER | QTY | `/officer/offers/{id}` |
| `ORDER_PAID`, `ORDER_RECEIPT_CONFIRMED`, `ORDER_CANCELLED_BY_BUYER`, `ORDER_CANCEL_REQUESTED` | ORDER | QTY | `/officer/orders/{id}` |
| `ORDER_PROBLEM_REPORTED` | ORDER | QTY | OFFICER: `/officer/orders/{id}`; ADMIN: `/admin/orders/{id}` |
| `DISPUTE_RESOLVED` | ORDER | QTY | OFFICER: `/officer/orders/{id}`; BUYER: `/buyer/orders/{id}` |
| `COOPERATIVE_VERIFIED`, `COOPERATIVE_REJECTED`, `COOPERATIVE_SUSPENDED`, `COOPERATIVE_REINSTATED` | COOPERATIVE | NONE | `/officer/onboarding` |
| `CERTIFICATE_EXPIRING`, `CERTIFICATE_EXPIRED` | COOPERATIVE | DATE | `/officer/onboarding` |
| `OFFER_ACCEPTED`, `OFFER_COUNTERED`, `OFFER_DECLINED`, `OFFER_EXPIRED` | OFFER | QTY | `/buyer/offers/{id}` |
| `DELIVERY_QUOTED` | THREAD | LOT | `/messages/{id}` |
| `PAYMENT_CONFIRMED`, `ORDER_PREPARING`, `ORDER_DELIVERED`, `ORDER_EXPIRED`, `ORDER_CANCELLED_BY_COOPERATIVE`, `CANCEL_REQUEST_AGREED`, `CANCEL_REQUEST_REFUSED` | ORDER | QTY | `/buyer/orders/{id}` |
| `DELIVERY_DATE_SET` | ORDER | QTY_DATE | `/buyer/orders/{id}` |
| `REFUND_SENT` | ORDER | MONEY | `/buyer/orders/{id}` |
| `COOPERATIVE_SUBMITTED` | COOPERATIVE | COOP | `/admin/cooperatives/{id}` |
| `PAYOUT_PROBLEM` | ORDER | PROBLEM | `/admin/payouts` |
| `RECONCILIATION_ISSUE` | ORDER | PROBLEM | `/admin/orders/{id}` |
| `NAME_CHANGE_REQUESTED` | NAME_CHANGE | NONE | `/admin/names/{id}` |
| `BANK_CHANGE_CONFIRMED` | BANK_CHANGE | NONE | `/admin/payouts` |
| `CATALOG_REQUEST_FORWARDED` | CATALOG_REQUEST | ITEM | `/board` |
| `MESSAGE_RECEIVED` | THREAD | LOT | `/messages/{id}` |

`toAlertView` copies `data` into `params`, except: `amountKobo` becomes `amount`, formatted with the naira formatter in `src/lib/money.ts`; `date` is formatted the way the order pages format a delivery date. If the stored `data` fails its kind's parser, `params` is `{}`, `malformed` is `true`, and the view still returns (the interface then shows `alerts.fallback`).

**Copy.** `messages/en.json` gets `alerts.kind.<KIND>` for every kind, plus `alerts.title` ("Alerts"), `alerts.bell` ("Alerts, {count, plural, =0 {none unread} other {# unread}}"), `alerts.empty` ("No alerts yet"), `alerts.markAll` ("Mark all as read"), `alerts.seeAll` ("See all"), `alerts.unread` ("Unread"), `alerts.fallback` ("Something changed. Open to see it."), `alerts.older` / `alerts.newer` for paging. Sentences are plain and name the thing, for example:

- `OFFER_RECEIVED`: "New offer for {quantity} {unit} of {crop}."
- `PAYMENT_CONFIRMED`: "Your payment for {quantity} {unit} of {crop} arrived. It is held until delivery is confirmed."
- `ORDER_DELIVERED`: "Your {crop} order was marked delivered. Confirm you received it."
- `PAYOUT_SENT`: "{amount} was sent to your bank for {crop}."
- `MEMBERSHIP_REMOVED`: "{cooperative} removed you as a member."

Only `en.json` changes: English is the only enabled locale and no test requires the other files to match.

- [ ] **Step 1: Write the failing tests** (`tests/unit/notification-views.test.ts`)

```ts
import en from "../../messages/en.json";

it("every_kind_has_a_sentence_a_parser_and_a_link", () => {
  for (const kind of ALERT_KINDS) {
    expect(en.alerts.kind[kind], kind).toBeTypeOf("string");
    expect(DATA[kind], kind).toBeDefined();
    expect(hrefOf(kind, "OFFICER", "x1"), kind).toMatch(/^\//);
  }
});
it("no_alert_sentence_says_escrow", () => {
  expect(JSON.stringify(en.alerts).toLowerCase()).not.toContain("escrow");
});
it("data_shapes_reject_unknown_fields", () => {
  expect(DATA.OFFER_RECEIVED.safeParse({ crop: "Maize", quantity: 4, unit: "Bag", floorKobo: 1 }).success).toBe(false);
  expect(DATA.LOT_APPROVED.safeParse({ crop: "Maize", phone: "0803" }).success).toBe(false);
});
it("links_follow_the_role", () => {
  expect(hrefOf("PAYOUT_SENT", "FARMER", "o1")).toBe("/farmer/earnings/o1");
  expect(hrefOf("PAYOUT_SENT", "OFFICER", "o1")).toBe("/officer/orders/o1");
  expect(hrefOf("ORDER_PROBLEM_REPORTED", "ADMIN", "o1")).toBe("/admin/orders/o1");
  expect(hrefOf("DISPUTE_RESOLVED", "BUYER", "o1")).toBe("/buyer/orders/o1");
  expect(hrefOf("MEMBERSHIP_REMOVED", null, "m1")).toBe("/farmer");
});
it("formats_a_kobo_amount_held_as_a_string", () => {
  const view = toAlertView(row({ kind: "PAYOUT_SENT", role: "FARMER", data: { crop: "Maize", amountKobo: "12500000" } }));
  expect(view.params.amount).toBe(formatNaira(12500000n));
  expect(view.params).not.toHaveProperty("amountKobo");
});
it("flags_malformed_stored_data_instead_of_failing", () => {
  expect(toAlertView(row({ kind: "OFFER_RECEIVED", data: { nonsense: true } }))).toMatchObject({ params: {}, malformed: true });
  expect(toAlertView(row({ kind: "BANK_CHANGE_APPLIED", data: {} })).malformed).toBe(false);
});
```

`row(overrides)` is a local builder returning a full `Notification` object. Use the money formatter's real name and argument type from `src/lib/money.ts`.

- [ ] **Step 2: Run to see them fail.** Run: `npx vitest run tests/unit/notification-views.test.ts`. Expected: FAIL, modules not found.
- [ ] **Step 3: Write `schema.ts`, `views.ts` and the `alerts` block in `messages/en.json`.**
- [ ] **Step 4: Run to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: alert kinds, view mapper and copy"`

---

### Task 3: `notify` and the recipient helpers

**Files:**
- Create: `src/modules/notifications/service.ts`, `tests/integration/alert-helpers.ts`
- Modify: `src/modules/notifications/recipients.ts`
- Test: `tests/integration/notify.test.ts`

**Interfaces:**
- Consumes: `AlertKind`, `AlertData`, `DATA` from Task 2.
- Produces:

```ts
// recipients.ts
export type Db = Prisma.TransactionClient | typeof prisma;
export type Recipient = { userId: string; role: Role | null; cooperativeId: string | null };
export function buyer(userId: string): Recipient;              // role BUYER, cooperative null
export function person(userId: string): Recipient;             // role null, cooperative null
export function farmer(userId: string, cooperativeId: string): Recipient;
export async function officersOf(db: Db, cooperativeId: string): Promise<Recipient[]>;   // ACTIVE OFFICER memberships
export async function activeAdmins(db: Db): Promise<Recipient[]>;                        // ACTIVE ADMIN, distinct user
export async function activeBoardAdmins(db: Db): Promise<Recipient[]>;
export async function farmersOfLot(db: Db, lotId: string): Promise<Recipient[]>;         // Lot.farmerUserId plus every LotContribution.farmerUserId, distinct, cooperative = the lot's
export async function threadAudience(db: Db, threadId: string): Promise<Recipient[]>;    // counterpart (BUYER or FARMER by Thread.kind) plus officersOf(thread.cooperativeId)

// service.ts
export async function notify<K extends AlertKind>(db: Db, input: {
  kind: K;
  subject: { type: NotificationSubjectType; id: string };
  data: AlertData[K];
  to: Recipient[];
  exclude?: string | null;      // the acting user's id
}): Promise<void>;

// tests/integration/alert-helpers.ts
export async function alertsFor(userId: string): Promise<Notification[]>;   // newest first
export async function alertKinds(userId: string): Promise<string[]>;
```

`notify` parses `data` with `DATA[kind]` (throws on a bad shape: that is a programming error and tests catch it), drops `exclude`, removes duplicate recipients (same user, role and cooperative), and inserts with `createMany`. For `MESSAGE_RECEIVED` only, a recipient who already has an unread row with the same `kind` and `subjectId` gets that row's `createdAt` set to now and no new row.

- [ ] **Step 1: Write the failing tests** (`tests/integration/notify.test.ts`, `lotWorld()` fixture)

```ts
it("writes_one_row_per_recipient_and_none_for_the_actor", async () => {
  const second = await officerMember("u-officer-2", world.cooperativeId);
  await notify(prisma, {
    kind: "LOT_SUBMITTED", subject: { type: "LOT", id: "lot-1" }, data: { crop: "Maize" },
    to: await officersOf(prisma, world.cooperativeId), exclude: world.officer.userId,
  });
  expect(await alertKinds(second.userId)).toEqual(["LOT_SUBMITTED"]);
  expect(await alertKinds(world.officer.userId)).toEqual([]);
  const [row] = await alertsFor(second.userId);
  expect(row).toMatchObject({ role: "OFFICER", cooperativeId: world.cooperativeId, readAt: null, subjectId: "lot-1" });
});
it("writes_nothing_and_does_not_fail_when_no_one_is_left", async () => {
  await expect(notify(prisma, {
    kind: "LOT_SUBMITTED", subject: { type: "LOT", id: "lot-1" }, data: { crop: "Maize" },
    to: await officersOf(prisma, world.cooperativeId), exclude: world.officer.userId,
  })).resolves.toBeUndefined();
  expect(await prisma.notification.count()).toBe(0);
});
it("does_not_double_up_a_recipient_listed_twice", async () => { /* to: [buyer(b), buyer(b)] → 1 row */ });
it("rolls_back_with_the_transaction", async () => { /* notify inside prisma.$transaction that then throws → 0 rows */ });
it("rejects_data_with_a_field_the_kind_does_not_have", async () => { /* data: { crop, floorKobo } → rejects, 0 rows */ });
it("keeps_one_unread_message_alert_per_thread", async () => {
  /* notify MESSAGE_RECEIVED twice for the same thread and recipient → 1 row, createdAt of the second call */
});
it("starts_a_new_message_alert_once_the_last_was_read", async () => { /* set readAt, notify again → 2 rows */ });
it("lists_inactive_officers_and_admins_out", async () => { /* REMOVED officer membership is not in officersOf; activeAdmins returns each admin once */ });
it("finds_every_farmer_on_a_lot", async () => { /* lot with a second LotContribution → both farmers, cooperativeId = lot's */ });
```

Write each commented test out in full in the same style.

- [ ] **Step 2: Run to see them fail.** Run: `npx vitest run tests/integration/notify.test.ts`. Expected: FAIL, `notify` not exported.
- [ ] **Step 3: Implement `recipients.ts` helpers, `notify`, and `alert-helpers.ts`.** Keep `listActiveAdminEmails` as it is.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat: notify and recipient helpers"`

---

### Task 4: Reading and marking alerts

**Files:**
- Modify: `src/modules/notifications/service.ts`
- Test: `tests/integration/alerts-read.test.ts`

**Interfaces:**
- Produces:

```ts
export const ALERTS_PER_PAGE = 20;
export async function countOwnUnread(actor: Actor): Promise<number>;
export async function latestOwnAlerts(actor: Actor): Promise<AlertView[]>;              // ten newest
export async function listOwnAlerts(actor: Actor, page: number): Promise<{ alerts: AlertView[]; page: number; pages: number }>;
export async function markRead(actor: Actor, id: string): Promise<{ href: string }>;    // NotFoundError if absent, ForbiddenError if not theirs
export async function markAllRead(actor: Actor): Promise<void>;
```

Every function checks `can(actor, "notification:own", { ownerUserId })` first (`actor.userId` for the list functions, the row's `userId` for `markRead`). The visible set is: `userId = actor.userId` AND (`role` is null OR `role = actor.role`) AND (`cooperativeId` is null OR `cooperativeId = actor.cooperativeId`). `markRead` on a row outside the visible set but owned by the actor (another role's alert) is a `ForbiddenError`. `listOwnAlerts` clamps `page` to `1..pages` (`pages` is at least 1); a non-finite page is 1. `markRead` leaves an already-read row's `readAt` unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
it("counts_and_lists_only_the_alerts_of_the_role_in_use", async () => {
  // one user with a BUYER alert and an OFFICER alert for world.cooperativeId
  expect(await countOwnUnread(asBuyer)).toBe(1);
  expect((await latestOwnAlerts(asOfficer)).map((a) => a.kind)).toEqual(["LOT_SUBMITTED"]);
});
it("shows_personal_alerts_under_every_role", async () => {
  await notify(prisma, { kind: "MEMBERSHIP_REMOVED", subject: { type: "MEMBERSHIP", id: "m1" }, data: { cooperative: "Zuma Farmers" }, to: [person(user.id)] });
  expect(await countOwnUnread(asBuyer)).toBe(1);
  expect(await countOwnUnread(asOfficer)).toBe(1);
});
it("hides_an_officers_alerts_for_another_cooperative", async () => { /* role OFFICER, other cooperativeId → count 0 */ });
it("returns_the_ten_newest_first", async () => { /* 12 rows → 10, newest createdAt first */ });
it("pages_twenty_at_a_time_and_clamps_the_page", async () => {
  // 45 rows
  expect((await listOwnAlerts(actor, 1)).alerts).toHaveLength(20);
  expect(await listOwnAlerts(actor, 99)).toMatchObject({ page: 3, pages: 3 });
  expect((await listOwnAlerts(actor, 0)).page).toBe(1);
  expect((await listOwnAlerts(actor, Number.NaN)).page).toBe(1);
});
it("gives_one_page_when_there_are_no_alerts", async () => { /* { alerts: [], page: 1, pages: 1 } */ });
it("marks_one_read_and_returns_its_link", async () => { /* readAt set; href equals the view's; count drops by 1 */ });
it("refuses_to_mark_another_persons_alert", async () => { /* rejects ForbiddenError; readAt still null */ });
it("refuses_to_mark_an_alert_for_a_role_not_in_use", async () => { /* ForbiddenError */ });
it("says_not_found_for_an_unknown_id", async () => { /* NotFoundError */ });
it("marks_all_read_for_the_role_in_use_only", async () => { /* other role's row stays unread */ });
```

- [ ] **Step 2: Run to see them fail.** Run: `npx vitest run tests/integration/alerts-read.test.ts`
- [ ] **Step 3: Implement the five functions.**
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat: read and mark alerts"`

---

### Tasks 5 to 10: the event hooks

Each of these tasks adds `notify` calls to existing service functions. They share one pattern.

**Pattern for every row in the tables below:**

1. Write an integration test named as given. It performs the real service call with the existing fixtures (`lotWorld`, `paidWorld`, `paidOrder`, `seedOrder`, `farmerMember`, `officerMember`, `buyerMember`), then asserts with `alertKinds(userId)` that each listed recipient has exactly that kind, that the actor has none, and with `alertsFor` that `role`, `cooperativeId`, `subjectType`, `subjectId` and `data` are as the row and the Task 2 table say.
2. Run it and see it fail (no alert written).
3. Add the `notify` call. If the function has a transaction, call `notify(tx, ...)` inside it. If it has a bare conditional `updateMany`, call `notify(prisma, ...)` straight after it, inside `if (count === 1)`.
4. Run it and see it pass.

Recipient shorthand: **officers** = `officersOf(db, cooperativeId)`; **farmers** = `farmersOfLot(db, lotId)`; **buyer** = `buyer(buyerUserId)`; **admins** = `activeAdmins(db)`. `exclude` is always the acting user's id (omit it for webhook and scheduled-job functions).

`data` values come from rows the function already loads: crop name and unit name from the lot, quantity from the offer or order. Load them inside the same transaction if the function has not already. Never read `floorKobo` for an alert.

Each task also gets one test, `a_refused_change_writes_no_alert`: call one of the task's functions in a state where it throws `ConflictError` (already decided, wrong status) and assert `prisma.notification.count()` is unchanged.

Commit once per task: `git commit -m "feat: alerts for <area> events"`.

---

### Task 5: Lot and catalog-request alerts

**Files:**
- Modify: `src/modules/catalog/lots.ts`, `revisions.ts`, `screening.ts`, `requests.ts`
- Test: `tests/integration/alerts-catalog.test.ts`

| Test name | Call | Recipients and kind |
|---|---|---|
| `tells_officers_a_lot_was_submitted` | `submitLot` | officers: `LOT_SUBMITTED` |
| `tells_officers_a_farmer_asked_to_change_a_lot` | `requestRevision` | officers: `LOT_REVISION_REQUESTED` |
| `tells_farmers_their_change_was_decided` | `decideRevision` (approve, then refuse in a second test) | farmers: `LOT_REVISION_DECIDED` |
| `tells_officers_a_lot_was_withdrawn` | `withdrawLot` | officers: `LOT_WITHDRAWN` |
| `tells_farmers_their_lot_was_approved` | `approveLot` | farmers: `LOT_APPROVED` |
| `tells_farmers_their_lot_was_rejected` | `rejectLot` | farmers: `LOT_REJECTED` |
| `tells_farmers_their_lot_was_countered` | `counterLot` | farmers: `LOT_COUNTERED` |
| `tells_officers_a_counter_was_answered` | `screening.ts` `respondToCounter` | officers: `LOT_COUNTER_ANSWERED` |
| `tells_officers_a_crop_or_unit_was_requested` | `requestCatalogItem` | officers: `CATALOG_REQUEST_MADE` |
| `tells_board_admins_a_request_was_forwarded` | `forwardCatalogRequest` | `activeBoardAdmins`: `CATALOG_REQUEST_FORWARDED` |
| `tells_the_farmer_an_officer_declined_their_request` | `declineCatalogRequestAsOfficer` | `person(requestedByUserId)`: `CATALOG_REQUEST_DECLINED` |
| `tells_the_farmer_the_board_declined_their_request` | `declineCatalogRequest` | `person(requestedByUserId)`: `CATALOG_REQUEST_DECLINED` |
| `tells_every_requester_when_an_item_is_approved` | `approveCatalogRequest` with open requests for the same name from two cooperatives | each request's `person(requestedByUserId)`: `CATALOG_REQUEST_APPROVED`, once each, subject = their own request |

The `data.crop` for lot kinds is the lot's crop name. `ITEM` data is `{ itemKind: request.kind, name: request.name }`.

---

### Task 6: Offer alerts

**Files:**
- Modify: `src/modules/marketplace/offers.ts`, `negotiation.ts`
- Test: `tests/integration/alerts-offers.test.ts`

| Test name | Call | Recipients and kind |
|---|---|---|
| `tells_officers_an_offer_arrived` | `makeOffer` | officers: `OFFER_RECEIVED` |
| `tells_the_buyer_their_offer_was_accepted` | `respondToOffer` ACCEPT at or above the floor | buyer: `OFFER_ACCEPTED` |
| `asks_the_farmer_when_an_offer_below_the_floor_is_accepted` | `respondToOffer` ACCEPT below the floor | farmers: `OFFER_NEEDS_FARMER` (subject LOT, id = lot id); buyer: nothing |
| `tells_the_buyer_their_offer_was_declined` | `respondToOffer` REJECT | buyer: `OFFER_DECLINED` |
| `tells_the_buyer_their_offer_was_countered` | `respondToOffer` COUNTER | buyer: `OFFER_COUNTERED` |
| `tells_buyer_and_officers_the_farmer_agreed` | `farmerRespondToOffer` agree | buyer: `OFFER_ACCEPTED`; officers: `OFFER_FARMER_ANSWERED` |
| `tells_buyer_and_officers_the_farmer_refused` | `farmerRespondToOffer` refuse | buyer: `OFFER_DECLINED`; officers: `OFFER_FARMER_ANSWERED` |
| `tells_officers_the_buyer_answered_a_counter` | `negotiation.ts` `respondToCounter` (accept, then decline in a second test) | officers: `OFFER_COUNTER_ANSWERED` |
| `tells_officers_an_offer_was_withdrawn` | `withdrawOffer` | officers: `OFFER_WITHDRAWN` |
| `tells_the_buyer_their_offer_expired_once` | `expireOffers(now)` twice | buyer: `OFFER_EXPIRED`, exactly one row after the second run |

No offer alert carries a price: `QTY` has no money field.

`makeOffer` and `respondToOffer` can post a typed note through `postToBuyerThread`. That note raises no message alert (Task 10 keeps `postToBuyerThread` silent), because the offer alert already covers it. Give two of these tests a note and assert the recipient has exactly one alert.

---

### Task 7: Order alerts

**Files:**
- Modify: `src/modules/orders/delivery.ts`, `cancel.ts`, `disputes.ts`, `expiry.ts`, `quotes.ts`, `complete.ts`
- Test: `tests/integration/alerts-orders.test.ts`

| Test name | Call | Recipients and kind |
|---|---|---|
| `tells_the_buyer_preparation_started` | `startPreparing` | buyer: `ORDER_PREPARING` |
| `tells_the_buyer_the_delivery_date` | `setDeliveryDate` (and a second call changing the date) | buyer: `DELIVERY_DATE_SET` each time, `data.date` = the new date |
| `tells_the_buyer_the_order_was_marked_delivered` | `markDelivered` | buyer: `ORDER_DELIVERED` |
| `tells_officers_the_buyer_confirmed_receipt` | `confirmReceipt` | officers: `ORDER_RECEIPT_CONFIRMED` |
| `does_not_tell_officers_when_an_order_completes_by_timer` | `runOrderTimers` completing a delivered order | officers: no `ORDER_RECEIPT_CONFIRMED` |
| `tells_officers_and_admins_a_problem_was_reported` | `reportProblem` (both the report and the after-completion branches) | officers and admins: `ORDER_PROBLEM_REPORTED` |
| `tells_buyer_and_officers_a_problem_was_resolved` | `resolveDispute` | buyer and officers: `DISPUTE_RESOLVED`; the deciding admin: nothing |
| `tells_officers_the_buyer_cancelled_before_preparation` | `cancelOrder` as buyer, order `PAID_HELD` | officers: `ORDER_CANCELLED_BY_BUYER` |
| `tells_officers_the_buyer_asked_to_cancel` | `cancelOrder` as buyer, order `PREPARING` | officers: `ORDER_CANCEL_REQUESTED` |
| `tells_the_buyer_the_cooperative_cancelled` | `cancelOrder` as officer | buyer: `ORDER_CANCELLED_BY_COOPERATIVE` |
| `tells_the_buyer_their_cancel_request_was_agreed` | `answerCancelRequest` agree | buyer: `CANCEL_REQUEST_AGREED` |
| `tells_the_buyer_their_cancel_request_was_refused` | `answerCancelRequest` refuse | buyer: `CANCEL_REQUEST_REFUSED` |
| `tells_the_buyer_their_unpaid_order_expired_once` | `expireUnpaidOrders(now)` twice | buyer: `ORDER_EXPIRED`, one row |
| `tells_the_buyer_a_delivery_price_was_quoted` | `quoteDelivery`, and `quoteDeliveryInThread` | buyer: `DELIVERY_QUOTED` (subject THREAD, id = the buyer thread's id) |

Notes:
- `confirmReceipt` delegates to `completeOrder`, which the timer also reaches. Write `ORDER_RECEIPT_CONFIRMED` in `confirmReceipt`, after `completeOrder` reports that it completed the order, not inside `completeOrder`.
- `refundInFull` is shared by three callers; put each cancel alert in its caller, on the path where `refundInFull` changed the order, not in `refundInFull`.
- `resolveDispute` claims the dispute with a bare `updateMany` (OPEN to RESOLVED): notify when that count is 1.

---

### Task 8: Payment, payout and refund alerts

**Files:**
- Modify: `src/modules/payments/payments.ts`, `sending.ts`, `refunds.ts`, `alerts.ts`
- Test: `tests/integration/alerts-payments.test.ts`

| Test name | Call | Recipients and kind |
|---|---|---|
| `tells_buyer_officers_and_farmers_a_payment_arrived` | `confirmPayment(reference)` | buyer: `PAYMENT_CONFIRMED`; officers: `ORDER_PAID`; farmers: `LOT_ORDER_PAID` |
| `a_second_confirmation_writes_nothing_more` | `confirmPayment` again (returns `ALREADY_CONFIRMED`), then `reconcile(now)` | row count unchanged |
| `a_payment_that_is_refunded_tells_no_one_to_prepare` | `confirmPayment` for an order whose stock is gone (outcome `REFUNDING`) | officers and farmers: nothing; buyer: no `PAYMENT_CONFIRMED` (they get `REFUND_SENT` when the refund settles) |
| `tells_the_farmer_their_payout_was_sent` | `settleAttempt` with a paid outcome for a FARMER payout | that farmer: `PAYOUT_SENT`, `data.amountKobo` = the payout amount as a string |
| `tells_officers_the_cooperatives_payout_was_sent` | same for a COOPERATIVE payout | officers: `PAYOUT_SENT` |
| `a_replayed_transfer_event_writes_no_second_alert` | `settleTransferEvent` for the same transfer twice | one `PAYOUT_SENT` row per recipient |
| `tells_the_farmer_on_a_late_success` | the FAILED-then-PAID repair branch (`sending.ts` near line 83) | that farmer: `PAYOUT_SENT`, once |
| `tells_the_buyer_their_refund_was_sent` | `settleRefund` processed | buyer: `REFUND_SENT` |
| `a_replayed_refund_event_writes_no_second_alert` | `settleRefund` twice | one row |
| `a_failed_refund_tells_admins_not_the_buyer` | `settleRefund` failed | admins: `PAYOUT_PROBLEM` with `problem: "REFUND_FAILED"`; buyer: nothing |
| `tells_admins_about_a_failed_payout` | `settleAttempt` failed outcome | admins: `PAYOUT_PROBLEM`, `problem: "FAILED"` |
| `tells_admins_about_a_reconciliation_issue` | the path that calls `alertAdmins` with `RECONCILIATION` or `STALE` | admins: `RECONCILIATION_ISSUE` |
| `an_alert_write_failure_in_alert_admins_does_not_throw` | call `alertAdmins` with `notify` made to throw (`vi.spyOn`) | resolves; the email is still in the fake outbox |

Notes:
- `confirmPayment` has two successful branches. The three payment alerts are written only on the `PAID` branch, where the order moves to `PAID_HELD`, inside that transaction. The `REFUNDING` branch writes none.
- `PAYOUT_SENT` is written where the payout row becomes `PAID` (both places in `settleAttempt`), inside the transaction, when the payout `updateMany` count is 1. Resolve the recipient from `Payout.recipientType` and `recipientId` the way the farmer earnings read does; a COOPERATIVE payout goes to `officersOf`.
- `PAYOUT_PROBLEM` and `RECONCILIATION_ISSUE` are written inside the exported `alertAdmins` in `payments/alerts.ts`, in its own try/catch beside the email: kinds `RECONCILIATION` and `STALE` map to `RECONCILIATION_ISSUE`, the rest to `PAYOUT_PROBLEM`; subject is the order; `data.problem` is the alert kind. Do not touch the unexported `alertAdmins` in `banking/service.ts`.
- These functions have no actor: no `exclude`.

---

### Task 9: Membership, cooperative, name and bank alerts

**Files:**
- Modify: `src/modules/farmers/service.ts`, `src/modules/cooperatives/service.ts`, `src/modules/cooperatives/expiry.ts`, `src/modules/name-changes/service.ts`, `src/modules/banking/service.ts`
- Test: `tests/integration/alerts-people.test.ts`

| Test name | Call | Recipients and kind |
|---|---|---|
| `tells_officers_a_farmer_asked_to_join` | `joinViaLink` | officers: `FARMER_ASKED_TO_JOIN`, `data.name` = the farmer's name |
| `tells_the_farmer_they_were_approved` | `approveFarmer` | `person(farmer)`: `MEMBERSHIP_APPROVED` |
| `tells_the_farmer_they_were_rejected` | `rejectFarmer` | `person(farmer)`: `MEMBERSHIP_REJECTED` |
| `tells_the_farmer_they_were_removed` | `removeFarmer` | `person(farmer)`: `MEMBERSHIP_REMOVED` |
| `a_removed_farmer_sees_the_alert_under_another_role` | `removeFarmer`, then give the same user a BUYER membership with `buyerMember` | `latestOwnAlerts(buyerActor)` contains `MEMBERSHIP_REMOVED` |
| `tells_officers_a_farmer_left` | `leaveCooperative` | officers: `FARMER_LEFT` |
| `tells_admins_a_cooperative_is_ready_to_verify_once` | `uploadDocument` for the last required document, then one more upload | admins: `COOPERATIVE_SUBMITTED`, one row |
| `tells_officers_each_cooperative_decision` | `verifyCooperative`, `rejectCooperative`, `suspendCooperative`, `reinstateCooperative` | officers: the matching `COOPERATIVE_*` kind; the deciding admin: nothing |
| `tells_officers_a_certificate_is_expiring_once_per_date` | `runCertificateExpiry(now)` twice inside the 30-day window | officers: `CERTIFICATE_EXPIRING`, one row |
| `tells_officers_a_certificate_expired_once` | `runCertificateExpiry(now)` twice after expiry | officers: `CERTIFICATE_EXPIRED`, one row |
| `tells_admins_a_name_change_is_waiting` | `requestOwnNameChange`, `requestCooperativeRename` | admins: `NAME_CHANGE_REQUESTED` |
| `tells_the_person_their_name_change_was_decided` | `approveNameChange` / `rejectNameChange` on a personal request | `person(requestedByUserId)`: `NAME_CHANGE_APPROVED` / `NAME_CHANGE_REJECTED` |
| `tells_officers_their_rename_was_decided` | the same on a cooperative rename | officers of that cooperative: the same kinds |
| `tells_admins_bank_details_were_confirmed` | `confirmBankChange` | admins: `BANK_CHANGE_CONFIRMED` |
| `tells_the_owner_new_bank_details_took_effect_once` | `applyDueBankChanges(now)` twice | FARMER owner: `person(the farmer's userId)`; COOPERATIVE owner: officers; `BANK_CHANGE_APPLIED`, one row each |

Notes:
- Membership decisions go through `applyTransition` (a bare conditional `updateMany`): notify after it when the count is 1, next to the existing `emailFarmer` call.
- Cooperative decisions: one `notify` in `transition()` beside `notifyOfficers`, mapped from the transition (`rejectCooperative` is PENDING to PENDING, so map from the caller's intent, not the status pair).
- Certificate alerts go beside the existing officer emails in `expiry.ts`, under the same guards (the lapse `updateMany` count, and the `runOnce` reminder key), so they repeat exactly as often as the emails do.
- `BankChangeRequest.ownerId` is a farmer profile id for FARMER owners: resolve the user id from the profile.
- No bank field goes into `data` (`NONE` shape).

---

### Task 10: Message alerts

**Files:**
- Modify: `src/modules/messaging/service.ts`
- Test: `tests/integration/alerts-messages.test.ts`

**Interfaces:**
- Consumes: `threadAudience`, `notify`.
- Changes: the private `writeMessage` gains a last parameter `alert: boolean`. `postMessage` passes `true`. `postToBuyerThread` (the note typed with an offer or an answer, already covered by the offer alert) and `writeComposedMessage` (delivery quotes) pass `false`. When `true`, it calls `notify(tx, { kind: "MESSAGE_RECEIVED", subject: { type: "THREAD", id: threadId }, data: { crop }, to: await threadAudience(tx, threadId), exclude: actor.userId })` inside its existing transaction.

- [ ] **Step 1: Write the failing tests**

```ts
it("tells_officers_when_the_buyer_writes", async () => { /* officers: ["MESSAGE_RECEIVED"]; buyer: [] */ });
it("tells_the_buyer_when_an_officer_writes", async () => { /* buyer has it, role BUYER; the writing officer none; a second officer has it */ });
it("tells_the_farmer_on_a_farmer_thread", async () => { /* FARMER_COOPERATIVE thread: farmer row has role FARMER and the cooperativeId */ });
it("keeps_one_unread_alert_however_many_messages", async () => { /* three postMessage calls → one row for the buyer */ });
it("a_system_message_raises_no_message_alert", async () => { /* postSystemMessage → no MESSAGE_RECEIVED */ });
it("a_note_sent_with_an_offer_raises_no_message_alert", async () => { /* makeOffer with a note → officers' kinds are exactly ["OFFER_RECEIVED"] */ });
it("a_delivery_quote_raises_no_message_alert", async () => { /* quoteDelivery → buyer kinds are exactly ["DELIVERY_QUOTED"] */ });
it("a_refused_message_writes_no_alert", async () => { /* body with a phone number → ValidationError, 0 rows */ });
```

- [ ] **Step 2: Run to see them fail.** Run: `npx vitest run tests/integration/alerts-messages.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat: alerts for new messages"`

---

### Task 11: The summary route, the actions and the `/alerts` page

**Files:**
- Create: `src/app/api/alerts/summary/route.ts`, `src/app/alerts/actions.ts`, `src/app/alerts/page.tsx`, `src/components/alert-list.tsx`
- Test: `tests/integration/alerts-summary-route.test.ts`

**Interfaces:**
- Consumes: `countOwnUnread`, `latestOwnAlerts`, `listOwnAlerts`, `markRead`, `markAllRead`, `AlertView`.
- Produces:

```ts
// route.ts (no `export const dynamic`: next.config.ts sets cacheComponents, and reading the session already makes the route dynamic)
export async function GET(): Promise<Response>;   // 200 { unread: number, alerts: AlertView[] } | 401 { code: "UNAUTHENTICATED" }; header Cache-Control: no-store
export type AlertSummary = { unread: number; alerts: AlertView[] };

// actions.ts ("use server")
export async function openAlertAction(formData: FormData): Promise<void>;                 // field "id"; markRead, revalidatePath("/", "layout"), redirect(href); on NotFound or Forbidden, redirect("/alerts")
export async function markAllAlertsReadAction(): Promise<ActionResult<AlertSummary>>;     // markAllRead, revalidatePath("/", "layout"), returns the fresh summary

// alert-list.tsx (client)
export function AlertList(props: { alerts: AlertView[]; itemClassName?: string }): JSX.Element;
```

`AlertList` renders each alert as a `<form action={openAlertAction}>` with a hidden `id` and one submit button holding the sentence (`useTranslations("alerts")`, `t(\`kind.${kind}\`, params)`, or `t("fallback")` when `malformed` is true), a relative or short date, and an unread marker with the visually hidden text `t("unread")`. It works without JavaScript.

`/alerts` uses `requireActorForPage`, reads `?page=`, calls `listOwnAlerts(actor, Number(page))`, and shows the title, a "Mark all as read" button, `AlertList`, the empty state, and older/newer links when `pages > 1`.

The route handler gets the actor with `getActor()`; a null actor is the 401.

- [ ] **Step 1: Write the failing route test.** Mock `@/modules/identity/session` `getActor` with `vi.mock` (see how other integration tests stub the session; if none do, this is the first, keep the mock local to the file).

```ts
it("answers_401_when_signed_out", async () => { /* getActor → null; status 401; body { code: "UNAUTHENTICATED" } */ });
it("returns_the_count_and_newest_alerts_for_the_actor", async () => {
  /* two alerts for the buyer, one for someone else → { unread: 2, alerts: [2 views] }; Cache-Control is "no-store" */
});
```

- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement the route, the actions, `AlertList` and the page.**
- [ ] **Step 4: Run to see it pass**, then `npm run typecheck`.
- [ ] **Step 5: Commit.** `git commit -m "feat: alerts page, summary route and actions"`

---

### Task 12: The bell, on desktop and phones

**Files:**
- Create: `src/components/alert-bell.tsx`
- Modify: `src/components/ui/menu.tsx` (new optional prop), `src/components/app-nav.tsx` (bell wrapper near line 204), `src/app/layout.tsx` (`AlertSlot`, `bell` prop on `AppNav`)
- Modify: `docs/architecture.md`
- Test: `tests/e2e/alerts.spec.ts`

**Interfaces:**
- Consumes: `AlertSummary`, `AlertList`, `markAllAlertsReadAction`, `GET /api/alerts/summary`.
- Produces:

```ts
// menu.tsx: Menu gains
onOpen?: () => void;   // called each time the panel opens

// alert-bell.tsx (client)
export function AlertBell(props: { initial: AlertSummary }): JSX.Element;

// layout.tsx
async function AlertSlot(): Promise<JSX.Element | null>;   // getActor(); null → null; else <AlertBell initial={{ unread, alerts }} />
```

Behaviour:
- State starts from `initial`. A `useEffect` on `usePathname()` fetches `/api/alerts/summary` with `cache: "no-store"` and replaces the state; a 401 or a network error leaves the state as it is. The first run (mount) is skipped, since `initial` is fresh.
- When the layout renders again and passes a different `initial`, the bell adopts it. `openAlertAction` and `markAllAlertsReadAction` both call `revalidatePath("/", "layout")`, so the bell is right after "Mark all as read" on the `/alerts` page and after opening an alert that links to the page the person is already on, the two cases where the pathname does not change.
- At `lg` and wider it renders `Menu` (`align="end"`, `hideChevron`, `onOpen` = the same fetch) with `AlertList` of the ten alerts, then "Mark all as read" (calls `markAllAlertsReadAction` and sets state from its result) and a "See all" link to `/alerts`; `t("empty")` when there are none. Below `lg` it renders a plain link to `/alerts` instead. Both are in the DOM and switched with `hidden lg:block` / `lg:hidden`.
- The button is a bell icon in the style of the account button (44px target). The count badge shows the number, "9+" above nine, and is absent at zero. The accessible name is `t("bell", { count })`.
- In `app-nav.tsx` the bell wrapper becomes `<div className="flex items-center">{bell}</div>`: it is no longer hidden below the breakpoint. Check at 375px wide that the header bar still fits the logo, bell, account button and menu button on one line.
- `NavSlot` passes `bell={<Suspense fallback={null}><AlertSlot /></Suspense>}`.
- `docs/architecture.md`: the `notifications/` line now reads that the module holds in-app alerts (`notify`, the bell reads) as well as email copy; note `GET /api/alerts/summary`.

- [ ] **Step 1: Write the failing end-to-end spec** (`tests/e2e/alerts.spec.ts`). Model the set-up on `tests/e2e/marketplace.spec.ts` (`setUpLotWorld`, `journey.ts` helpers). Scope locators to `getByRole("main")` or the header as the other specs do.

```ts
test("an officer is told about a new offer and the count clears", async ({ browser, request }) => {
  // set up a verified cooperative with a live lot, an officer and a buyer
  // buyer: sign in, make an offer on the lot
  // officer: sign in → land on /officer/orders
  //   bell is named "Alerts, 1 unread"
  //   click the nav link to Lots (client-side navigation), then have the buyer post a message on the lot thread
  //   click the nav link to Offers → bell becomes "Alerts, 2 unread" without a reload
  //   open the bell, click "New offer for … of …" → URL is /officer/offers/<id>, bell is "Alerts, 1 unread"
  //   open the bell, "Mark all as read" → bell is "Alerts, none unread"
});
test("the bell follows the alerts page and an alert for the current page", async ({ browser, request }) => {
  // officer with two unread OFFER_RECEIVED alerts for two offers
  // go to /officer/offers/<first id>, open the bell, click the alert for that same offer → still on that page, bell is "Alerts, 1 unread"
  // go to /alerts, click "Mark all as read" on the page → bell is "Alerts, none unread" without leaving the page
});
test("on a phone the bell is in the header and opens the alerts page", async ({ browser, request }) => {
  // viewport 375x812, same officer with one unread alert
  // the bell link is visible without opening the menu; clicking it → /alerts, the alert is listed
});
test("a signed-in person with no role is sent away from the alerts page without an error", async ({ browser, request }) => {
  // sign up a user and give them no membership; goto /alerts → lands where requireActorForPage sends them; no bell in the header; no error boundary
});
test("an old alert still opens a page", async ({ browser, request }) => {
  // buyer makes an offer, then withdraws it; officer opens the OFFER_RECEIVED alert
  // the page responds 200 and shows the offer as withdrawn (no 404, no error boundary)
});
```

Write the five tests out in full with the helpers.

- [ ] **Step 2: Run to see them fail.** Run: `npx playwright test tests/e2e/alerts.spec.ts`. Expected: FAIL, no element named "Alerts, 1 unread". (Integration tests and Playwright share a database: never run them at the same time.)
- [ ] **Step 3: Implement the bell, the `Menu` prop, the nav change and the slot.**
- [ ] **Step 4: Run to see them pass**, then the whole e2e suite once: `npx playwright test`. The nav change can move things other specs click; fix any spec that breaks because of the bell, and report any that fail for another reason without changing them.
- [ ] **Step 5: Commit.** `git commit -m "feat: alert bell in the header on desktop and phones"`

---

### Task 13: Final checks and the pull request

- [ ] **Step 1:** Run `npm run lint`, `npm run typecheck`, `npm test`, then `npx playwright test`. All pass, or each failure is shown to be one of the known flaky tests by a rerun.
- [ ] **Step 2:** Run the `audit` subagent on the committed branch against `CLAUDE.md`. Fix what it finds.
- [ ] **Step 3:** Check spec section 4 row by row against the tests in Tasks 5 to 10: every kind in `NotificationKind` is written by at least one service function. A kind nothing writes is a bug.
- [ ] **Step 4:** Push the branch and open the pull request. The description states:
  - what was built, and the migration name `notifications`;
  - **"Apply the `notifications` migration to staging before merging"**, with the command the earlier phase pull requests give for staging;
  - the choices from spec section 11, plus any made during the build;
  - which subagent ran each search and each test run, and any done without one;
  - anything in Review Focus that turned out differently from the plan.
- [ ] **Step 5:** Stop. Do not merge.
