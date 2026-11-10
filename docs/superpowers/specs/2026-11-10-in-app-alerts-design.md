# In-app alerts: design

Date: 2026-11-10. Status: agreed in conversation, awaiting review of this file.

## 1. Purpose

When something happens that a person needs to act on or know about, AgroHub saves an alert for them. A bell in the header shows how many they have not opened and lists them. Each alert links to the page where the person deals with it.

Today nothing in the app tells a buyer their offer was answered, an officer that an order was paid, or anyone that a message arrived. They have to go and look.

This serves all five roles: farmer, officer, buyer, admin and board admin.

## 2. Scope

In this stage:

- A `notification` table and a `notifications` service.
- Alerts written by the existing service functions listed in section 4.
- A bell in the header on desktop and phones, and an `/alerts` page.
- Alerts for new messages in a thread.

Not in this stage:

- Emails for these events. Spec section 6.11 describes them; they wait for the Resend domain. The existing emails (admin payout alerts, cooperative status, membership decisions, invites, bank changes, certificate expiry) stay exactly as they are.
- Price-change alerts for followed crops (roadmap item 8.2).
- Settings to mute alerts or choose alert types.
- Live updates while a page is open.
- Role dashboards. They are the next stage and have their own design.

The interface calls the feature "Alerts". The code and table use `notification`, the name `docs/architecture.md` already gives the entity.

## 3. Rules that apply to every alert

1. The person who did the action is never alerted about it.
2. "Officers" means every active officer of that cooperative. "Admins" means every active admin. "Board admins" means every active board admin. Each person gets their own row with their own read state.
3. An alert belongs to one of the person's roles. A farmer who is also a buyer has farmer alerts and buyer alerts, and the bell shows the ones for the role they are using.
4. An alert never contains a floor price, a phone number or bank data.
5. An alert is written only if the change it reports was saved.
6. An alert reports a change of state, not a function call. Several functions can be reached twice for the same event: `confirmPayment` from both the webhook and the reconciliation job, `settleAttempt` from five callers, `settleRefund` on a replayed webhook. Each already decides with a conditional update (`updateMany` with the old status in `where`) and returns `ALREADY_CONFIRMED` or `ALREADY_SETTLED` when it changed nothing. The alert is written only on the branch where that update changed one row.

## 4. Events

"Opens" is the page the alert links to. The tables name the list page for brevity. Where the role has a detail page for the subject, the alert opens that instead. These exist today: `/farmer/lots/[id]`, `/farmer/earnings/[orderId]`, `/officer/lots/[id]`, `/officer/offers/[id]`, `/officer/orders/[id]`, `/buyer/offers/[id]`, `/buyer/orders/[id]`, `/admin/orders/[id]`, `/admin/cooperatives/[id]`, `/admin/names/[id]` and `/messages/[id]`.

### 4.1 Farmer

| Kind | Event | Written by | Opens |
|---|---|---|---|
| `LOT_APPROVED` | Their lot was approved | `catalog/screening.ts` `approveLot` | `/farmer/lots` |
| `LOT_REJECTED` | Their lot was rejected | `rejectLot` | `/farmer/lots` |
| `LOT_COUNTERED` | Their lot was sent back with a counter | `counterLot` | `/farmer/lots` |
| `LOT_REVISION_DECIDED` | Their requested change was approved or refused | `catalog/revisions.ts` `decideRevision` | `/farmer/lots` |
| `OFFER_NEEDS_FARMER` | An offer on their lot is waiting on them | `marketplace/negotiation.ts` `respondToOffer`, when the officer accepts an offer below the floor and the offer moves to `AWAITING_FARMER` | `/farmer/lots` |
| `LOT_ORDER_PAID` | An order for their lot was paid | `payments/payments.ts` `confirmPayment` | `/farmer/earnings` |
| `PAYOUT_SENT` | Their payout was sent | `payments/sending.ts` `settleAttempt`, `settleTransferEvent` | `/farmer/earnings` |
| `MEMBERSHIP_APPROVED`, `MEMBERSHIP_REJECTED`, `MEMBERSHIP_REMOVED` | Their membership was decided | `farmers/service.ts` `approveFarmer`, `rejectFarmer`, `removeFarmer` | `/farmer` |
| `BANK_CHANGE_APPLIED` | Their new bank details took effect | `banking/service.ts` `applyDueBankChanges` | `/account` |
| `NAME_CHANGE_APPROVED`, `NAME_CHANGE_REJECTED` | Their name change was decided | `name-changes/service.ts` `approveNameChange`, `rejectNameChange` | `/account` |
| `CATALOG_REQUEST_APPROVED`, `CATALOG_REQUEST_DECLINED` | Their request for a crop or unit was decided | `catalog/requests.ts` `approveCatalogRequest`, `declineCatalogRequest` | `/farmer` |

"Their lot" means every farmer with a contribution to the lot.

### 4.2 Officer

| Kind | Event | Written by | Opens |
|---|---|---|---|
| `FARMER_ASKED_TO_JOIN` | A farmer asked to join | `farmers/service.ts` `joinViaLink` | `/officer/farmers` |
| `FARMER_LEFT` | A farmer left | `leaveCooperative` | `/officer/farmers` |
| `LOT_SUBMITTED` | A lot is waiting for screening | `catalog/lots.ts` `submitLot` | `/officer/lots` |
| `LOT_REVISION_REQUESTED` | A farmer asked to change a lot | `catalog/revisions.ts` `requestRevision` | `/officer/lots` |
| `LOT_COUNTER_ANSWERED` | A farmer answered a counter | `catalog/screening.ts` `respondToCounter` | `/officer/lots` |
| `LOT_WITHDRAWN` | A farmer withdrew a lot | `withdrawLot` | `/officer/lots` |
| `CATALOG_REQUEST_MADE` | A farmer asked for a crop or unit | `catalog/requests.ts` `requestCatalogItem` | `/officer/lots` |
| `OFFER_RECEIVED` | A buyer made an offer | `marketplace/offers.ts` `makeOffer` | `/officer/offers` |
| `OFFER_COUNTER_ANSWERED` | A buyer answered a counter | `negotiation.ts` `respondToCounter` | `/officer/offers` |
| `OFFER_FARMER_ANSWERED` | A farmer agreed to or refused an offer passed to them | `negotiation.ts` `farmerRespondToOffer` | `/officer/offers` |
| `OFFER_WITHDRAWN` | A buyer withdrew an offer | `withdrawOffer` | `/officer/offers` |
| `ORDER_PAID` | An order was paid and needs preparing | `payments/payments.ts` `confirmPayment` | `/officer/orders` |
| `ORDER_RECEIPT_CONFIRMED` | The buyer confirmed receipt | `orders/delivery.ts` `confirmReceipt` | `/officer/orders` |
| `ORDER_PROBLEM_REPORTED` | The buyer reported a problem | `orders/disputes.ts` `reportProblem` | `/officer/orders` |
| `ORDER_CANCELLED_BY_BUYER` | The buyer cancelled before preparation began and was refunded | `orders/cancel.ts` `cancelOrder`, buyer branch, order in `PAID_HELD` | `/officer/orders` |
| `ORDER_CANCEL_REQUESTED` | The buyer asked to cancel an order being prepared | `cancelOrder`, buyer branch, order in `PREPARING` | `/officer/orders` |
| `DISPUTE_RESOLVED` | A problem on their order was resolved | `orders/disputes.ts` `resolveDispute` | `/officer/orders` |
| `PAYOUT_SENT` | The cooperative's payout was sent | `payments/sending.ts` | `/officer/orders` |
| `COOPERATIVE_VERIFIED`, `COOPERATIVE_REJECTED`, `COOPERATIVE_SUSPENDED`, `COOPERATIVE_REINSTATED` | The cooperative's status changed | `cooperatives/service.ts` `transition`, which all four admin decisions go through and which already emails officers | `/officer/onboarding` |
| `CERTIFICATE_EXPIRING`, `CERTIFICATE_EXPIRED` | A certificate needs renewing | `cooperatives/expiry.ts` `runCertificateExpiry` | `/officer/onboarding` |
| `NAME_CHANGE_APPROVED`, `NAME_CHANGE_REJECTED` | A cooperative rename was decided | `name-changes/service.ts` | `/account` |

### 4.3 Buyer

| Kind | Event | Written by | Opens |
|---|---|---|---|
| `OFFER_ACCEPTED`, `OFFER_COUNTERED`, `OFFER_DECLINED` | Their offer was answered | `marketplace/negotiation.ts` `respondToOffer`, `farmerRespondToOffer` | `/buyer/offers` |
| `OFFER_EXPIRED` | Their offer ran out of time | `marketplace/offers.ts` `expireOffers` | `/buyer/offers` |
| `DELIVERY_QUOTED` | A delivery price was quoted | `orders/quotes.ts` `quoteDelivery`, `quoteDeliveryInThread` | `/messages` |
| `PAYMENT_CONFIRMED` | Their payment arrived and is held until delivery is confirmed | `payments/payments.ts` `confirmPayment` | `/buyer/orders` |
| `ORDER_PREPARING` | Their order is being prepared | `orders/delivery.ts` `startPreparing` | `/buyer/orders` |
| `DELIVERY_DATE_SET` | A delivery date was set or changed | `setDeliveryDate` | `/buyer/orders` |
| `ORDER_DELIVERED` | Their order was marked delivered and needs confirming | `markDelivered` | `/buyer/orders` |
| `ORDER_EXPIRED` | Their unpaid order ran out of time | `orders/expiry.ts` `expireUnpaidOrders` | `/buyer/orders` |
| `ORDER_CANCELLED_BY_COOPERATIVE` | The cooperative cancelled their order and they were refunded | `orders/cancel.ts` `cancelOrder`, officer branch | `/buyer/orders` |
| `CANCEL_REQUEST_AGREED`, `CANCEL_REQUEST_REFUSED` | Their request to cancel was answered | `answerCancelRequest` | `/buyer/orders` |
| `REFUND_SENT` | Their refund was sent | `payments/refunds.ts` `settleRefund` | `/buyer/orders` |
| `DISPUTE_RESOLVED` | Their reported problem was resolved | `orders/disputes.ts` `resolveDispute` | `/buyer/orders` |

### 4.4 Admin and board admin

| Who | Kind | Event | Written by | Opens |
|---|---|---|---|---|
| Admins | `COOPERATIVE_SUBMITTED` | A cooperative is waiting for verification | `cooperatives/service.ts` `uploadDocument`, when the last required document arrives and `submittedAt` is set | `/admin/cooperatives` |
| Admins | `ORDER_PROBLEM_REPORTED` | A problem was reported on an order | `orders/disputes.ts` `reportProblem` | `/admin/orders` |
| Admins | `PAYOUT_PROBLEM` | A payout failed or was blocked, or a refund failed | wherever `payments/alerts.ts` `alertAdmins` is called for these | `/admin/payouts` |
| Admins | `RECONCILIATION_ISSUE` | Reconciliation found a mismatch | `payments/reconcile.ts` | `/admin/orders` |
| Admins | `NAME_CHANGE_REQUESTED` | A name change is waiting | `name-changes/service.ts` `requestOwnNameChange`, `requestCooperativeRename` | `/admin/names` |
| Admins | `BANK_CHANGE_CONFIRMED` | Someone confirmed new bank details | `banking/service.ts` `confirmBankChange` | `/admin/payouts` |
| Board admins | `CATALOG_REQUEST_FORWARDED` | A crop or unit request was forwarded | `catalog/requests.ts` `forwardCatalogRequest` | `/board` |

### 4.5 Messages

| Kind | Event | Written by | Opens |
|---|---|---|---|
| `MESSAGE_RECEIVED` | Someone wrote in a thread they take part in | `messaging/service.ts` `postMessage`, `postToBuyerThread` | the thread under `/messages` |

- The alert goes to the other side of the thread: the buyer, or the cooperative's officers, or the farmer, according to the thread's kind.
- If the person already has an unread `MESSAGE_RECEIVED` alert for that thread, its time is moved to now and no second row is added. One thread is one line in the bell however long the chat.
- System messages written by `postSystemMessage` raise no message alert. The event that caused them already raises its own.

## 5. Data

One new model in `prisma/schema.prisma`, one migration named `notifications`.

```prisma
model Notification {
  id            String                  @id @default(cuid())
  userId        String
  user          User                    @relation(fields: [userId], references: [id], onDelete: Cascade)
  role          Role
  cooperativeId String?
  kind          NotificationKind
  // Polymorphic: the lot, offer, order, thread or cooperative the alert is about. No foreign key.
  subjectType   NotificationSubjectType
  subjectId     String
  data          Json
  readAt        DateTime?
  createdAt     DateTime                @default(now())

  @@index([userId, role, readAt])
  @@index([userId, role, createdAt])
  @@index([userId, kind, subjectId])
  @@map("notification")
}
```

- `NotificationKind` is an enum of the kinds in section 4.
- `NotificationSubjectType` is an enum: `LOT`, `OFFER`, `ORDER`, `THREAD`, `COOPERATIVE`, `MEMBERSHIP`, `NAME_CHANGE`, `CATALOG_REQUEST`, `BANK_CHANGE`, `PAYOUT`.
- `data` holds only what the sentence needs: crop name, quantity and unit, cooperative name, a date, or an amount in integer kobo. Each kind has a typed shape in `src/modules/notifications/schema.ts`. Floor prices, phone numbers and bank data have no field in any shape.
- `role` and `cooperativeId` record which of the person's roles the alert is for.
- Old events are not backfilled. The bell starts empty.
- Alerts are kept indefinitely. There is no clean-up job in this stage.

## 6. Service

All in `src/modules/notifications/`, beside the existing `emails.ts` and `recipients.ts`.

**`service.ts`**

- `notify(tx, { kind, subject, data, to, exclude })` writes one row per recipient. `to` is a list of `{ userId, role, cooperativeId }`. `exclude` is the acting user's id. It takes the caller's transaction client, so the alert is saved with the change or not at all.
- `listOwnAlerts(actor, { page })`, `latestOwnAlerts(actor)` (ten newest), `countOwnUnread(actor)`.
- `markRead(actor, id)`, `markAllRead(actor)`.

The read and mark functions take an `Actor` and check `can(actor, "notification:own", { ownerUserId })` first. They filter by `actor.userId`, `actor.role` and `actor.cooperativeId`.

`notify` takes no `Actor`. It is an internal write, called only from other services after their own `can` check and from webhook and scheduled-job functions that have no actor. `alertAdmins` in `payments/alerts.ts` and `postSystemMessage` in `messaging/service.ts` are the existing functions of this kind. `tx` is a `Prisma.TransactionClient`, the type the other modules already pass around.

**`recipients.ts`** gains helpers that return recipient lists: `officersOf(tx, cooperativeId)`, `activeAdmins(tx)`, `activeBoardAdmins(tx)`, `farmersOfLot(tx, lotId)`, `buyerOf(order | offer)`, `otherSideOfThread(tx, threadId, authorUserId)`.

**`views.ts`** maps a row to what the interface shows: `{ id, sentence, href, read, createdAt }`. The sentence and link for every kind are built here from `kind`, `subjectId` and `data`. This is the only place alert copy lives, and the only way an alert leaves the server.

**Copy** follows the project rule: the held payment is "payment held until delivery is confirmed", never "escrow".

**Where the calling function has a transaction,** `notify` runs inside it. Where it has none, `notify` runs directly after the conditional update, and only if that update changed a row. `transition` in `cooperatives/service.ts` and `uploadDocument` are of this second kind.

**Collapsing messages.** For `MESSAGE_RECEIVED`, `notify` first looks for the recipient's unread row with the same `kind` and `subjectId`. If there is one it sets `createdAt` to now; otherwise it inserts. Two messages landing at the same instant could leave two rows; that is accepted.

## 7. Interface

**Bell.** `src/components/alert-bell.tsx`, a client component built on the kit menu (`src/components/ui/menu.tsx`). `src/app/layout.tsx` gets an `AlertSlot` server component, written like the existing `AccountSlot`, which loads the unread count and the ten newest alerts for the signed-in actor and passes the bell into `AppNav`'s `bell` prop. Signed-out visitors get no bell.

- The bell shows the unread count, or "9+" above nine, and nothing at zero. Its accessible name states the count.
- Desktop: the bell opens a list of the ten newest alerts. Unread ones are marked. Below the list are "Mark all as read" and "See all".
- Phones: `AppNav` renders the bell in the header bar beside the menu button, always visible, as a link straight to `/alerts`. This changes the current behaviour, where the slot is hidden below the `lg` breakpoint.
- Opening an alert marks it read through a server action, then goes to its link.
- An empty bell says "No alerts yet".

**`/alerts` page.** The full list for the role in use, newest first, twenty per page, with "Mark all as read". It uses `require-actor-page`.

**Freshness.** The count updates when the person moves to another page or reloads, not while they sit on a page. The root layout does not render again when someone follows a link inside the app, so the slot alone would leave the count stale until a full reload. The bell therefore also asks for its data itself:

- `GET /api/alerts/summary` returns the unread count and the ten newest alerts for the signed-in actor, through `countOwnUnread` and `latestOwnAlerts` and the `views.ts` mapper. It answers 401 when signed out and is never cached.
- The bell calls it when the pathname changes and when the list is opened. The slot's data is only the first paint.
- The mark-read actions return the new count, so the bell is right immediately after one.

**Roles.** After switching role with the role switcher, the bell shows that role's alerts.

## 8. Errors

- A failed alert write inside a transaction rolls the change back with it, like any other write in that transaction. `notify` does only inserts and one lookup, with no outside calls, so in normal running it adds no new kind of failure to payment confirmation or payout settlement.
- The one case where it does: code that writes alerts running against a database without the `notification` table. Every change in section 4, payment confirmation included, would then fail until the migration is applied. Section 10 orders the rollout to prevent this. The alternative is to write alerts after the transaction commits and swallow failures, as `alertAdmins` does; an alert could then be lost, but a change could never be blocked by one. This design takes the first option (choice 7 in section 11).
- A recipient list can be empty (a cooperative with no other active officer). `notify` then writes nothing and does not fail.
- `markRead` on an alert that is not the actor's fails the `can` check and changes nothing.
- A link whose subject has since been removed or closed still opens the list page for that kind.

## 9. Tests

- **Unit** (`tests/unit`): every kind produces a sentence and a link; no sentence contains "escrow"; the `data` shapes accept no private field.
- **Integration** (`tests/integration`): for each event in section 4, the right people get a row, with the right role, and the actor gets none. Message alerts collapse to one unread row per thread. A change that fails leaves no alert. A replayed payment, transfer or refund event, and a reconciliation run after the webhook, write no second alert.
- **Access** (`tests/access`): a person cannot list, count, open or mark another person's alerts, or their own alerts for a role they are not using.
- **End to end**: a buyer makes an offer; the officer sees the count on the bell, opens the alert, lands on the offer, and the count clears. The officer reaches the bell by following a link inside the app, not by a fresh page load, so the test covers the refresh on navigation. One run at phone width checks the bell is visible and opens `/alerts`.

## 10. Rollout

- One pull request from its own branch and worktree, built in its own session.
- The `notifications` migration is applied to the staging database before the pull request is merged, because the public link deploys `main` against staging. If the merge came first, every change in section 4 would fail on the public link until the migration ran. The same order applies to the real production database at launch.
- No new dependency. No new environment variable. No new scheduled job.
- `docs/architecture.md` is updated: the `notifications/` module now holds in-app alerts as well as email copy.

## 11. Choices made where the spec was silent

Each took the simpler option and is repeated in the pull request description.

1. In-app only; event emails wait.
2. The count refreshes on page load, with no polling.
3. The bell shows the alerts of the role in use, not all roles together.
4. Alerts are kept indefinitely.
5. On phones the bell links to the page instead of opening a list.
6. Alert sentences are built at read time from `kind` and `data`, not stored as text.
7. Alerts are written in the caller's transaction, including on the payment and payout paths.
