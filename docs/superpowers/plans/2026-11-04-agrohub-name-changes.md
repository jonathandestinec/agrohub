# AgroHub: Admin-Approved Name Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person, or an officer for a verified cooperative, asks for a name change with a reason and a supporting document; an admin who is not involved approves it (the name changes and an audit row is written) or rejects it with a reason; while a request is pending no bank change can start, and the existing payout account is never touched.

**Architecture:** A new module `src/modules/name-changes/` (`service.ts`, `schema.ts`, `views.ts`) owns one table, `NameChangeRequest`, whose subject is either a user (`USER`, subject id = `User.id`) or a cooperative (`COOPERATIVE`, subject id = `Cooperative.id`), like `BankChangeRequest`'s owner. Documents go to the private bucket through `putPrivate` and are opened only through `signedUrl`. The bank rules stay in `src/modules/banking/service.ts`, which gains one read (`payoutAccountFor`) used by the name-change service and one guard (`NAME_CHANGE_PENDING`) inside `applyBankAccount`, the previews and `confirmBankChange`. Screens: `/account/name` for anyone signed in, a rename section on `/officer/onboarding`, and `/admin/names` plus `/admin/names/[id]` for admins; the admin cooperative review page gains the payout account card.

**Tech Stack:** As Phase 3 (Next.js 16, Prisma 7, Better Auth, Vitest, Playwright). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-31-agrohub-design.md` sections 2 (anti-goals: nobody redirects money), 3 (roles; admins), 6.1 (private bucket, signed links; bank account and recipient code), 6.2 (farmer bank account), 8 (audit log of admin actions; phone and bank data private), 13 ("bank account names are checked against the registered name"), 14 (bank detail changes: email confirmation, officer two-factor, 48 hours, admin alert; account safety). The design for this task was agreed with the user on 2026-11-04 (recorded in the session brief and below). Architecture: `docs/architecture.md` sections 2, 3, 5, 8.

## Global Constraints

- Nobody renames themselves directly: Better Auth's `/update-user` stays disabled (`src/lib/auth.ts`). `User.name` and `Cooperative.name` (after verification) change only through an approved `NameChangeRequest`.
- One PENDING request per subject at a time, enforced by a partial unique index, not only by a read.
- An admin never decides a request they made, a request about themselves, or a request about a cooperative they hold any membership in.
- Approval updates the name and writes the audit row in the same transaction. The existing payout account (recipient code, account name, bank name) is never changed by a name change.
- While a request is PENDING, no bank change can start or be confirmed for that subject (`NAME_CHANGE_PENDING`). After approval, a bank change follows the existing rules unchanged (the 48-hour confirmed path with the admin alert whenever an account already exists).
- Documents: PDF, JPEG or PNG, at most 10,485,760 bytes, contents checked against the declared type; stored with `putPrivate`, opened only with `signedUrl` (300 seconds, as cooperative documents).
- Private fields leave the server only through `name-changes/views.ts` mappers: never a storage key, recipient code, phone number or confirmation token. Audit `meta` holds ids, kinds and statuses only, never a name, a reason or a storage key.
- Every service function takes an `Actor` and calls `can()` first, except the self-scoped personal functions, which take `{ userId }` like `setOwnFarmerBankAccount` (a PENDING farmer has no Actor) and carry a comment saying so.
- All user-facing strings in `messages/*.json`, keys mirrored in all five files (`tests/unit/i18n.test.ts`). Never call the held payment "escrow".
- Migrations: `npx prisma migrate dev --create-only` against the scratch database `agrohub_nc_scratch` only, reviewed, then `npx prisma generate`. Tests run on `agrohub_nc_test` through `.superpowers/vitest.nc.mts`.
- Before each commit: `npm run lint`, `npm run typecheck`, `npm test` (on the private config). No Co-Authored-By or "Generated with" lines. Stage files explicitly; many files are CRLF, so use the Edit tool and check `git diff --stat`.

## Review Focus

1. A person or officer submits a name change while a bank change is waiting for its email confirmation or inside its 48 hours, or starts a bank change in the moment between submitting a name change and the admin's decision: one of the two is refused, and a bank change is never confirmed while a name change is pending (Task 1 `name_change_refused_while_bank_change_open`; Task 4 `bank_change_refused_while_name_change_pending`, `bank_confirm_refused_while_name_change_pending`).
2. An admin who is also an officer (or farmer) of the cooperative, or the person being renamed, approves the request; or the only admin asks for their own rename: refused with `CANNOT_DECIDE_OWN_NAME_CHANGE`, the request stays PENDING and is listed with `canDecide: false` (Task 3 `admin_cannot_decide_own_request`, `admin_member_of_cooperative_cannot_decide`).
3. Two admins act on one request at once, or the requester withdraws while an admin approves: exactly one change wins; the name changes at most once and exactly one decision audit row exists (Task 3 `concurrent_decisions_have_one_winner`, `withdraw_during_approval_has_one_winner`).
4. A second request for the same subject arrives while one is pending, including two at the same instant from two officers of one cooperative: the second gets `NAME_CHANGE_ALREADY_PENDING` and its document is not left behind as a database row (Task 1 `second_pending_request_is_refused`, Task 2 `two_officers_racing_get_one_request`).
5. The new name is the same as the current one apart from spaces, is blank, has no letters, or is a capitalisation fix: same-after-cleaning is `NAME_UNCHANGED`, blank or letterless is `INVALID_NAME`, a capitalisation fix is accepted (Task 1 `name_rules`).

## Decisions this plan makes

Agreed by the user (2026-11-04):
- A `NameChangeRequest` holds the new name, a reason and one supporting document in the private bucket. One pending request per person (and per cooperative). An admin approves or rejects with a reason, never their own. Approval updates the name and writes an audit row.
- While a request is pending, no bank change is allowed. After approval the next bank change takes the normal 48-hour confirmed path with an admin alert; the existing payout account is untouched.
- Cooperative names after verification follow the same rule: an officer requests, an admin approves.
- The admin cooperative review screen shows the cooperative's bank account. It does not today (`AdminCooperative` deliberately omits bank fields), so Task 6 adds it.
- The farmer-details edit (size, state, LGA) is not built.

Made by this plan (the agreed design is silent; each is flagged in the PR under "Choices to check"):
- **One flow for every person.** Farmers, officers, buyers and admins all request a change to their own `User.name` at `/account/name`, self-scoped by `{ userId }` (no Actor, so a PENDING farmer can use it, as with the bank form). An officer's personal name and their cooperative's name are separate requests; the cooperative rename lives on the officer's cooperative page.
- **A pending name change and an open bank change exclude each other.** A name change is refused (`BANK_CHANGE_OPEN`) while a bank change for the same payout account is awaiting confirmation (within its 24 hours) or confirmed and inside its 48-hour wait. In the other direction a bank change is refused (`NAME_CHANGE_PENDING`) at request, at the live name preview and at email confirmation. The alternative (cancelling the waiting bank change when a name change is filed) was rejected because it would let a name-change request silently undo a change the owner confirmed. "The payout account" of a person is their farmer profile's account; a person with no farmer profile has none, so only the name-change check against pending name changes applies to them.
- **A pending name change also blocks the first bank account** (no account yet), because the first account is checked against the name that is about to change.
- **An approved cooperative rename changes the public name at once**: every screen reads `Cooperative.name` live (the public lots list, the officer's and farmers' pages). The registration number does not change. The current payout account stays; the next bank change is checked against the new name, so an account still in the old name can be replaced only after the bank renames it too.
- **Cooperative renames need the officer's two-factor**, like bank changes (`cooperative:rename` = OFFICER, own cooperative, `twoFactorEnabled`), because the name drives the bank-name check. Personal renames need no two-factor (farmers do not have it).
- **A PENDING (not yet verified) cooperative is still renamed directly** through the existing `updateCooperativeDetails` correction path; a rename request for it is refused (`COOPERATIVE_NOT_VERIFIED`). VERIFIED and SUSPENDED cooperatives use the request.
- **Document kinds:** a person chooses `AFFIDAVIT`, `MARRIAGE_CERTIFICATE` or `PUBLIC_NOTICE` (a gazette or newspaper notice); a cooperative uploads `AMENDED_REGISTRATION_CERTIFICATE` (the registrar's certificate showing the new name). Any other kind for that subject is `INVALID_DOCUMENT_KIND`. One document per request.
- **Name rules:** spaces trimmed and runs of spaces collapsed; 2 to 120 characters; at least one letter (`\p{L}`), else `INVALID_NAME`; equal to the current name after cleaning → `NAME_UNCHANGED`; a change of capitalisation only is allowed. The new name is not checked against the bank account (the admin sees that comparison instead). Reason 10 to 500 characters (`REASON_REQUIRED`, `REASON_TOO_LONG`); rejection reason 3 to 500.
- **The requester can withdraw a pending request** (status `WITHDRAWN`), so a typo does not block bank changes until an admin acts. For a cooperative, any officer allowed to request may withdraw.
- **"Never their own" is checked in the policy, not the screen.** `name:decide` is ADMIN, `ownerUserId` (the requester) not the actor, and `actorInCooperative === false`; for a person, the subject is the requester, so an admin can never decide their own rename. Consequence: while AgroHub has a single admin, that admin's own rename waits for a second admin (or a database change by the owner).
- **No emails.** The outcome shows on the requester's page; admins find requests in `/admin/names`. This follows Phase 3 (spec 6.11 event emails are Phase 8). The existing bank-change confirmation and admin alert emails are unchanged.
- **Audit rows carry ids only**: `name_change.request`, `name_change.withdraw`, `name_change.approve`, `name_change.reject` with `{ requestId, subjectType, subjectId }` (plus `documentKind` on request). The old and new names stay on the request row, which is the record; names are personal data and the audit log is append-only.
- **The admin's review shows the payout account name** for the subject (the farmer profile's or the cooperative's account name) and whether it matches the new name (`namesMatch`), so the admin knows a later bank change will be needed. It is information, never a reason the system refuses.
- **The shared file check moves** from `cooperatives/service.ts` to `src/lib/file-type.ts` (`DOCUMENT_CONTENT_TYPES`, `MAX_DOCUMENT_BYTES`, `matchesSignature`) so both modules use one copy; cooperative behaviour is unchanged.
- **Where people find it:** a "Change my name" link on `/farmer` and on `/officer/onboarding`. Buyer and admin screens on `main` have no profile page yet, so they reach `/account/name` by URL until a buyer home exists (Phase 4/6).

---

### Task 1: Personal name-change requests

**Files:**
- Modify: `prisma/schema.prisma`, `src/modules/cooperatives/service.ts` and `schema.ts` (use `src/lib/file-type.ts`), `src/modules/banking/service.ts` (add `payoutAccountFor`, re-export `namesMatch`), `tests/integration/helpers.ts` (`cleanDatabase` deletes `nameChangeRequest` first)
- Create: migration `name_change_requests` (hand-add the partial unique index), `src/lib/file-type.ts`, `src/modules/name-changes/service.ts`, `src/modules/name-changes/schema.ts`, `src/modules/name-changes/views.ts`
- Test: `tests/integration/name-changes.test.ts`, `tests/unit/file-type.test.ts`, `tests/unit/name-change-views.test.ts`

**Interfaces:**
- Produces:
  - Enums `NameSubjectType { USER COOPERATIVE }`, `NameChangeStatus { PENDING APPROVED REJECTED WITHDRAWN }`, `NameDocumentKind { AFFIDAVIT MARRIAGE_CERTIFICATE PUBLIC_NOTICE AMENDED_REGISTRATION_CERTIFICATE }`.
  - `model NameChangeRequest { id String @id @default(cuid()); subjectType NameSubjectType; subjectId String; fromName String; toName String; reason String; documentKind NameDocumentKind; storageKey String; contentType String; sizeBytes Int; status NameChangeStatus @default(PENDING); requestedByUserId String; decidedByUserId String?; rejectionReason String?; decidedAt DateTime?; createdAt DateTime @default(now()); @@index([status, createdAt]); @@index([subjectType, subjectId]) }` (`@@map("name_change_request")`). No foreign keys (the subject is polymorphic, like `BankChangeRequest`). The migration adds `CREATE UNIQUE INDEX "name_change_request_one_pending_key" ON "name_change_request" ("subjectType", "subjectId") WHERE status = 'PENDING';` and the schema comment names it.
  - `src/lib/file-type.ts`: `DOCUMENT_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const`, `MAX_DOCUMENT_BYTES = 10_485_760`, `matchesSignature(body: Buffer, contentType: string): boolean` (moved verbatim; `cooperatives/schema.ts` re-exports the first two under their old names).
  - `schema.ts`: `cleanName(raw: string): string` (trim, collapse whitespace; `ValidationError` `INVALID_NAME` outside 2 to 120 characters or with no letter); `cleanRequestReason(raw: string): string` (10 to 500); `PERSON_DOCUMENT_KINDS = ["AFFIDAVIT", "MARRIAGE_CERTIFICATE", "PUBLIC_NOTICE"]`, `COOPERATIVE_DOCUMENT_KINDS = ["AMENDED_REGISTRATION_CERTIFICATE"]`; `type NameChangeFile = { kind: NameDocumentKind; body: Buffer; contentType: string }`; `type NameChangeInput = { newName: string; reason: string }`.
  - `banking/service.ts`: `payoutAccountFor(subject: { type: "USER" | "COOPERATIVE"; id: string }, now: Date): Promise<{ accountName: string | null; changeOpen: boolean }>`, a system function (comment: no Actor; callers have authorised the subject). USER maps to the user's farmer profile, or `{ accountName: null, changeOpen: false }` when there is none. `changeOpen` uses the same "pending" condition as `bankAccountView` (unconfirmed within 24 hours, or confirmed with `effectiveAt > now`, not cancelled, not applied). `export { namesMatch } from "./names"`.
  - `service.ts`:
    - `requestOwnNameChange(user: { userId: string }, input: NameChangeInput, file: NameChangeFile, now = new Date()): Promise<OwnNameChange>`: kind in `PERSON_DOCUMENT_KINDS` (`INVALID_DOCUMENT_KIND`); file type, size and signature (`FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE`, `FILE_TYPE_MISMATCH`); `cleanName`; same as current `User.name` → `NAME_UNCHANGED`; `payoutAccountFor(USER).changeOpen` → `ConflictError` `BANK_CHANGE_OPEN`; an existing PENDING request → `ConflictError` `NAME_CHANGE_ALREADY_PENDING` (checked before the upload; the unique index's P2002 maps to the same code). Stores the file at `name-changes/USER/<userId>/<random hex>` with `putPrivate`, then creates the row and the `name_change.request` audit row in one transaction.
    - `getOwnNameChange(user: { userId }): Promise<OwnNameChange | null>`: the newest request for that user, any status.
    - `withdrawOwnNameChange(user: { userId }, requestId: string, now = new Date()): Promise<OwnNameChange>`: conditional `updateMany where { id, subjectType: "USER", subjectId: userId, status: "PENDING" }` → `WITHDRAWN`, `decidedAt` (count 0 → `ConflictError` `NAME_CHANGE_NOT_PENDING`; another user's id → the same, so ids cannot be probed); audit `name_change.withdraw`.
  - `views.ts`: `OwnNameChange = { id; subjectType; fromName; toName; documentKind; status; rejectionReason: string | null; createdAt: string; decidedAt: string | null }` via `toOwnNameChange(row)`, field by field (comment: the row also holds the storage key).

- [ ] **Step 1: Write the failing tests.**
  - `file-type.test.ts`: `%PDF` bytes match `application/pdf`; PNG bytes declared `image/jpeg` do not; a 2-byte body does not match `image/jpeg`.
  - `name-change-views.test.ts`: `JSON.stringify(toOwnNameChange(row))` contains neither the row's `storageKey` nor `requestedByUserId`.
  - `name-changes.test.ts`, with a user "Amina Bello" who has a farmer profile and payout account:
    - `requests_a_name_change`: a PDF affidavit, new name "Amina Musa", reason "Married in October 2026" → PENDING, `fromName` "Amina Bello", one object in `fakeStorage`, one `name_change.request` audit row whose `JSON.stringify(meta)` contains neither name nor the reason; `User.name` still "Amina Bello".
    - `name_rules`: `"  Amina   Musa "` is stored as `"Amina Musa"`; `"Amina  Bello"` → `NAME_UNCHANGED`; `"AMINA BELLO"` is accepted; `"  "` and `"12345"` → `INVALID_NAME`; a 121-character name → `INVALID_NAME`; reason "short" → `REASON_REQUIRED`.
    - Files: `AMENDED_REGISTRATION_CERTIFICATE` → `INVALID_DOCUMENT_KIND`; `image/gif` → `FILE_TYPE_NOT_ALLOWED`; PNG bytes declared `application/pdf` → `FILE_TYPE_MISMATCH`; 10,485,761 bytes → `FILE_TOO_LARGE`.
    - `second_pending_request_is_refused`: a second request → `NAME_CHANGE_ALREADY_PENDING` and the request count stays 1; after withdrawing, a new request succeeds.
    - `name_change_refused_while_bank_change_open`: with an unconfirmed `BankChangeRequest` created 1 hour ago for the farmer profile → `BANK_CHANGE_OPEN`; with one confirmed and `effectiveAt` 47 hours ahead → `BANK_CHANGE_OPEN`; with one unconfirmed and 25 hours old, or one already effective → accepted.
    - A user with no farmer profile (a buyer) can request.
    - `withdrawOwnNameChange` by another user → `NAME_CHANGE_NOT_PENDING`; a second withdraw → `NAME_CHANGE_NOT_PENDING`; `getOwnNameChange` shows `WITHDRAWN`.
- [ ] **Step 2: Run** `npx vitest run --config .superpowers/vitest.nc.mts tests/unit/file-type.test.ts tests/unit/name-change-views.test.ts tests/integration/name-changes.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the schema, migration (`DATABASE_URL=postgresql://agrohub:agrohub@localhost:5432/agrohub_nc_scratch npx prisma migrate dev --create-only --name name_change_requests`, then append the partial index), `npx prisma generate`, `file-type.ts` (and switch `cooperatives/service.ts` to it), `payoutAccountFor`, the module and the views.
- [ ] **Step 4: Run** the same command, then the full suite, `npm run typecheck`, `npm run lint`. Expected: PASS (existing cooperative document tests still pass).
- [ ] **Step 5: Commit** `feat: people ask for a name change with a reason and a document` (body: self-scoped like the bank form; refused while a bank change is open; one pending per person by partial unique index).

### Task 2: Cooperative rename requests

**Files:**
- Modify: `src/modules/name-changes/service.ts`, `src/modules/identity/policies.ts`, `tests/access/policy-matrix.test.ts`
- Test: `tests/integration/cooperative-renames.test.ts`

**Interfaces:**
- Consumes: Task 1 model, `cleanName`, `cleanRequestReason`, file checks, `payoutAccountFor`, `toOwnNameChange`.
- Produces:
  - Action `"cooperative:rename"`: `actor.role === "OFFICER" && actor.twoFactorEnabled && isOwnCooperative(actor, resource)`.
  - `requestCooperativeRename(actor, cooperativeId: string, input: NameChangeInput, file: NameChangeFile, now = new Date()): Promise<OwnNameChange>`: `can(actor, "cooperative:rename", { cooperativeId })`; cooperative status `PENDING` → `ValidationError` `COOPERATIVE_NOT_VERIFIED` (the officer edits the name directly instead); kind in `COOPERATIVE_DOCUMENT_KINDS`; otherwise the same rules and codes as Task 1 against `Cooperative.name` and `payoutAccountFor(COOPERATIVE)`; storage key `name-changes/COOPERATIVE/<cooperativeId>/<random hex>`; `requestedByUserId = actor.userId`.
  - `getCooperativeRename(actor, cooperativeId): Promise<OwnNameChange | null>`: `can(actor, "cooperative:read", { cooperativeId })`; newest request for the cooperative.
  - `withdrawCooperativeRename(actor, cooperativeId, requestId, now = new Date())`: `can(actor, "cooperative:rename", { cooperativeId })`; conditional update scoped to that cooperative (`NAME_CHANGE_NOT_PENDING`); audit `name_change.withdraw`.

- [ ] **Step 1: Write the failing tests.** Matrix: five `cooperative:rename` rows (only OFFICER true), and a separate case: an officer without two-factor → false; an officer of another cooperative → false. `cooperative-renames.test.ts`, with a VERIFIED "Zaria Grain Growers" whose bank account name is "ZARIA GRAIN GROWERS COOPERATIVE SOCIETY":
  - an officer with two-factor requests "Zaria Grain and Soy Growers" with an amended certificate (PNG) → PENDING, `subjectType` COOPERATIVE, `fromName` "Zaria Grain Growers"; `Cooperative.name` unchanged;
  - officer without two-factor → `ForbiddenError`; officer of another cooperative → `ForbiddenError`; a FARMER of the cooperative → `ForbiddenError`;
  - a PENDING cooperative → `COOPERATIVE_NOT_VERIFIED`; a SUSPENDED one → accepted;
  - `AFFIDAVIT` → `INVALID_DOCUMENT_KIND`;
  - a confirmed cooperative bank change inside its 48 hours → `BANK_CHANGE_OPEN`;
  - `two_officers_racing_get_one_request`: two officers call `requestCooperativeRename` through `Promise.allSettled` → one fulfilled, one `NAME_CHANGE_ALREADY_PENDING`, one row;
  - a personal request by the same officer is independent: both a personal and a cooperative request can be pending at once;
  - `getCooperativeRename` as an admin returns the pending request; `withdrawCooperativeRename` by the second officer → `WITHDRAWN`.
- [ ] **Step 2: Run** `npx vitest run --config .superpowers/vitest.nc.mts tests/integration/cooperative-renames.test.ts tests/access/policy-matrix.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the policy rule, matrix count update and the three service functions (share the request core with Task 1 through one private function taking the subject, the current name and the allowed kinds).
- [ ] **Step 4: Run** the same command, then the full suite, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat: officers ask for a verified cooperative's rename` (body: needs officer two-factor; PENDING cooperatives keep the direct edit).

### Task 3: Admin decisions

**Files:**
- Modify: `src/modules/name-changes/service.ts`, `src/modules/name-changes/views.ts`, `src/modules/identity/policies.ts`, `tests/access/policy-matrix.test.ts`
- Test: `tests/integration/name-change-decisions.test.ts`, `tests/unit/name-change-views.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2; `payoutAccountFor`, `namesMatch`, `signedUrl`.
- Produces:
  - `Resource` gains `actorInCooperative?: boolean`.
  - Actions `"name:queue"`: ADMIN. `"name:decide"`: `actor.role === "ADMIN" && resource?.ownerUserId !== undefined && resource.ownerUserId !== actor.userId && resource.actorInCooperative === false`.
  - Private `decisionResource(actor, request)`: `ownerUserId = request.requestedByUserId`; for USER, `actorInCooperative = request.subjectId === actor.userId` (so a request about the admin is refused even if someone else filed it; impossible today, kept for safety); for COOPERATIVE, true when the actor holds any membership (any role, any status) in that cooperative. A refused decision whose only failing condition is the self-relationship throws `ForbiddenError` with code `CANNOT_DECIDE_OWN_NAME_CHANGE`; anything else plain `ForbiddenError`.
  - `listNameChangeQueue(actor, now = new Date()): Promise<AdminNameChange[]>`: `can(actor, "name:queue")`; PENDING, oldest first.
  - `getNameChangeForReview(actor, requestId, now = new Date()): Promise<AdminNameChange>`: `name:queue`; any status (`NotFoundError` `NAME_CHANGE_NOT_FOUND`).
  - `getNameChangeDocumentUrl(actor, requestId): Promise<string>`: `name:queue`; `signedUrl(storageKey, 300)`.
  - `approveNameChange(actor, requestId, now = new Date()): Promise<AdminNameChange>`: `name:decide`; one transaction: `updateMany where { id, status: "PENDING" }` → APPROVED with `decidedByUserId`, `decidedAt` (count 0 → `ConflictError` `NAME_CHANGE_NOT_PENDING`); then `user.update({ name: toName })` or `cooperative.update({ name: toName })`; audit `name_change.approve` via `recordAudit(..., tx)`. Touches no bank field.
  - `rejectNameChange(actor, requestId, input: { reason: string }, now = new Date())`: `name:decide`; reason 3 to 500 (`REASON_REQUIRED`, `REASON_TOO_LONG`); PENDING → REJECTED with `rejectionReason`; audit `name_change.reject` (reason not in meta).
  - `AdminNameChange = OwnNameChange & { reason: string; subjectLabel: string (the user's email for USER, the cooperative's registration number for COOPERATIVE); requesterName: string; waitingDays: number; canDecide: boolean; payoutAccountName: string | null; newNameMatchesAccount: boolean | null }` via `toAdminNameChange(row, extras)`; never a phone, recipient code or storage key.

- [ ] **Step 1: Write the failing tests.** Matrix: five `name:queue` rows and five `name:decide` rows (resource `{ ownerUserId: "farmer-9", actorInCooperative: false }`: only ADMIN true), plus: ADMIN with `ownerUserId: "user-1"` → false; ADMIN with `actorInCooperative: true` → false; ADMIN with `actorInCooperative` missing → false. Views: `JSON.stringify(toAdminNameChange(...))` has no storage key or phone. `name-change-decisions.test.ts`:
  - `approves_a_personal_name_change`: admin approves "Amina Musa" → `User.name` "Amina Musa", status APPROVED, one `name_change.approve` row; the farmer profile's `recipientCode` and `accountName` are byte-for-byte unchanged.
  - `approves_a_cooperative_rename`: `Cooperative.name` changes; `recipientCode`, `accountName`, `bankName`, `registrationNumber` unchanged; `listLiveLots()` shows the new cooperative name on a live lot (use `lot-fixtures.ts`).
  - `rejects_with_a_reason`: reason "Affidavit is unsigned" → REJECTED, name unchanged, `getOwnNameChange` shows the reason; reason "no" → `REASON_REQUIRED`.
  - `admin_cannot_decide_own_request`: a user holding ADMIN files a personal request; as admin they approve → `CANNOT_DECIDE_OWN_NAME_CHANGE`; the queue lists it with `canDecide: false`; a second admin approves it.
  - `admin_member_of_cooperative_cannot_decide`: an admin who is also an officer of the cooperative (another officer filed it) → `CANNOT_DECIDE_OWN_NAME_CHANGE`.
  - `concurrent_decisions_have_one_winner`: `Promise.allSettled([approve(adminA), reject(adminB)])` → one fulfilled, one `NAME_CHANGE_NOT_PENDING`; exactly one decision audit row.
  - `withdraw_during_approval_has_one_winner`: `Promise.allSettled([approve, withdrawOwnNameChange])` → one wins; if the withdraw won, `User.name` is unchanged.
  - Approving an APPROVED or WITHDRAWN request → `NAME_CHANGE_NOT_PENDING`; a FARMER or OFFICER actor → `ForbiddenError`.
  - Review data: `payoutAccountName` "AMINA BELLO" and `newNameMatchesAccount: false` for "Amina Musa"; a buyer with no profile → `null` and `null`; `waitingDays` 3 for a request created 3 days before `now`.
  - `getNameChangeDocumentUrl` returns a URL for the admin; for an OFFICER → `ForbiddenError`.
- [ ] **Step 2: Run** `npx vitest run --config .superpowers/vitest.nc.mts tests/integration/name-change-decisions.test.ts tests/unit/name-change-views.test.ts tests/access/policy-matrix.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the policy rules, the reads and the two decisions.
- [ ] **Step 4: Run** the same command, then the full suite, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat: admins approve or reject name changes, never their own` (body: approval changes the name only, never the payout account; audit meta holds ids only).

### Task 4: No bank change while a name change is pending

**Files:**
- Modify: `src/modules/banking/service.ts`, `src/app/bank/confirm/page.tsx` (message for the new code), `src/app/farmer/error-key.ts`, `src/app/officer/onboarding/error-key.ts`, `messages/*.json`
- Test: `tests/integration/banking.test.ts` (new cases)

**Interfaces:**
- Consumes: the `NameChangeRequest` table.
- Produces:
  - Private `nameChangePending(owner: BankOwner): Promise<boolean>` in `banking/service.ts`: for FARMER, a PENDING USER request for the profile's `userId`; for COOPERATIVE, a PENDING COOPERATIVE request for the id. It reads `prisma.nameChangeRequest` directly, with a comment: the name-change service calls `payoutAccountFor` in this module, so this module reads the table itself instead of importing that service back (no import cycle).
  - `applyBankAccount`, `previewOwnFarmerBankAccount`, `previewCooperativeBankAccount` throw `ConflictError` `NAME_CHANGE_PENDING` before any Paystack call; `confirmBankChange` throws it before the conditional update (the request stays unconfirmed and can be confirmed after the decision while its 24 hours last).
  - Copy (farmer and officer bank forms, `/bank/confirm`): "Your name change is waiting for an admin. You can change your bank account after it is decided." / for a cooperative "…the cooperative's name change…".

- [ ] **Step 1: Write the failing tests** in `banking.test.ts`:
  - `bank_change_refused_while_name_change_pending`: a farmer with an account and a PENDING name change → `setOwnFarmerBankAccount` → `NAME_CHANGE_PENDING`, no `BankChangeRequest` row, `fakePaystack.recipients` is unchanged; the same for `previewOwnFarmerBankAccount`; a farmer with no account yet → `NAME_CHANGE_PENDING` too.
  - The same for a cooperative with a pending rename (`setCooperativeBankAccount`, `previewCooperativeBankAccount`).
  - `bank_confirm_refused_while_name_change_pending`: an unconfirmed bank change row, then a PENDING name-change row inserted directly (the race) → `confirmBankChange(token)` → `NAME_CHANGE_PENDING` and `confirmedAt` stays null.
  - `bank_change_after_approval_uses_new_name_and_waits`: after the name change to "Amina Musa" is approved, an account resolving to "AMINA MUSA" is accepted with `pending: true` (the 48-hour path), and one resolving to "AMINA BELLO" → `ACCOUNT_NAME_MISMATCH`; after a REJECTED or WITHDRAWN request, bank changes work as before.
- [ ] **Step 2: Run** `npx vitest run --config .superpowers/vitest.nc.mts tests/integration/banking.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the guard, the error-key entries and the copy.
- [ ] **Step 4: Run** the same command, then the full suite, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat: bank changes wait while a name change is pending`.

### Task 5: Request screens

**Files:**
- Create: `src/app/account/name/page.tsx`, `src/app/account/name/name-change-form.tsx` (shared by both screens), `src/app/account/name/actions.ts`, `src/app/account/name/error-key.ts`, `src/app/officer/onboarding/rename-section.tsx`
- Modify: `src/app/officer/onboarding/page.tsx`, `src/app/officer/actions.ts`, `src/app/farmer/page.tsx`, `messages/*.json`
- Test: `tests/unit/name-change-copy.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2 service functions; `currentUser`, `requireActor`.
- Produces:
  - Actions returning `ActionResult<OwnNameChange>`: `requestOwnNameChangeAction(form: FormData)` (`newName`, `reason`, `documentKind`, `document`), `withdrawOwnNameChangeAction({ requestId })`; `requestCooperativeRenameAction(form)` and `withdrawCooperativeRenameAction({ requestId })` in `officer/actions.ts` (cooperative id from the actor, never the form). Each revalidates `/account/name`, `/officer/onboarding`, `/admin/names`.
  - `/account/name` (signed-out → sign-in with `next`): the current name; if a request is PENDING, its new name, document kind and date with "Waiting for an admin" and a Withdraw button, and no form; otherwise the form (new name, reason, document kind select with the three person kinds, file input `accept="application/pdf,image/jpeg,image/png"`), and below it the last outcome ("Approved on …", or "Not approved: <reason>"). Lead copy: "Your name must match your bank account, so name changes are checked by an admin. While a request is waiting you cannot change your bank account."
  - `/officer/onboarding`, for a VERIFIED or SUSPENDED cooperative: a "Cooperative name" card with the same states, the one document kind, and, when the officer lacks two-factor, "Turn on two-factor authentication to request a name change" with a link to `/two-factor` instead of the form.
  - A "Change my name" link on `/farmer` (profile card) and on `/officer/onboarding`.
  - `nameChangeErrorKey(code)` mapping every code from Tasks 1, 2 and 4 to `nameChange.errors.*`, with `INTERNAL` as fallback.
- [ ] **Step 1: Write the failing test.** `name-change-copy.test.ts`: `nameChangeErrorKey` returns a key that exists in `messages/en.json` for each of `INVALID_NAME`, `NAME_UNCHANGED`, `REASON_REQUIRED`, `REASON_TOO_LONG`, `INVALID_DOCUMENT_KIND`, `FILE_TYPE_NOT_ALLOWED`, `FILE_TYPE_MISMATCH`, `FILE_TOO_LARGE`, `BANK_CHANGE_OPEN`, `NAME_CHANGE_ALREADY_PENDING`, `NAME_CHANGE_NOT_PENDING`, `COOPERATIVE_NOT_VERIFIED`, `FORBIDDEN`, and `INTERNAL` for an unknown code; no English string under `nameChange` contains "escrow".
- [ ] **Step 2: Run** `npx vitest run --config .superpowers/vitest.nc.mts tests/unit/name-change-copy.test.ts tests/unit/i18n.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the pages, form, actions and messages with the kit (`src/components/ui/`, inputs at least 44 px, data read inside `<Suspense>`). `next.config.ts`'s server-action body limit (`11mb`) already covers a 10 MB document; leave it.
- [ ] **Step 4: Run** the same command, then the full suite, typecheck and lint. Expected: PASS. (The screens are proved end to end in Task 7.)
- [ ] **Step 5: Commit** `feat: name change and cooperative rename request screens`.

### Task 6: Admin screens and the cooperative's bank account on review

**Files:**
- Create: `src/app/admin/names/page.tsx`, `src/app/admin/names/[id]/page.tsx`, `src/app/admin/names/[id]/decision-actions.tsx`
- Modify: `src/app/admin/actions.ts`, `src/app/admin/cooperatives/[id]/page.tsx`, `src/components/nav-links.ts`, `messages/*.json`
- Test: `tests/unit/header-nav.test.ts`, `tests/integration/verification.test.ts` (one case)

**Interfaces:**
- Consumes: Task 3 functions; `getCooperativeBankAccount`, `formatEffectiveAt`.
- Produces:
  - Nav: ADMIN gains `{ href: "/admin/names", labelKey: "nameChanges" }` after `/admin/cooperatives`.
  - Actions `approveNameChangeAction({ requestId })`, `rejectNameChangeAction({ requestId, reason })`, revalidating `/admin/names`, `/admin/names/<id>`, `/account/name`, `/officer/onboarding`.
  - `/admin/names`: pending requests oldest first: who (person name or cooperative name), "Person" or "Cooperative", from → to, waiting days chip, a "You can't decide this one" chip when `canDecide` is false; empty state.
  - `/admin/names/[id]`: current name, new name, reason, document kind with a "View document" signed link, requester, `subjectLabel`, submitted date, the payout account line ("Payout account name: AMINA BELLO. It does not match the new name, so they will need to change their bank account after this." or "…It matches the new name."; "No payout account yet."), and Approve / Reject (reason) when `canDecide`, else "You made this request or belong to this cooperative, so another admin must decide it." Decided requests show the outcome.
  - `/admin/cooperatives/[id]`: a "Payout account" card from `getCooperativeBankAccount(actor, id)`: bank name, account name, or "No bank account yet", and a pending change with its effective time.
- [ ] **Step 1: Write the failing tests.** Nav: `navLinksFor("ADMIN")` hrefs equal `["/admin/cooperatives", "/admin/names", "/admin/lots", "/admin/settings"]`. `verification.test.ts`: `getCooperativeBankAccount(admin, id)` returns the cooperative's `accountName` and `bankName` and no `recipientCode` key.
- [ ] **Step 2: Run** `npx vitest run --config .superpowers/vitest.nc.mts tests/unit/header-nav.test.ts tests/integration/verification.test.ts`. Expected: FAIL (nav).
- [ ] **Step 3: Implement** the pages, actions, nav entry and the payout card.
- [ ] **Step 4: Run** the same command, then the full suite, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat: admin name-change queue and review; cooperative review shows the payout account`.

### Task 7: End-to-end journey and docs

**Files:**
- Create: `tests/e2e/name-changes.spec.ts`
- Modify: `tests/e2e/journey.ts` (move `enrolTwoFactor` and the tiny `PDF` buffer here from `cooperative-to-farmer.spec.ts`, which then imports them), `tests/e2e/lot-world.ts` (optional cooperative `accountName`/`bankName`), `docs/architecture.md` (section 2: `name-changes/` module; section 5: `NameChangeRequest`; section 3 audit list: name changes), `docs/superpowers/specs/2026-10-31-agrohub-design.md` (section 14: a "Changing a name" bullet summarising the agreed rule)

**Interfaces:**
- Consumes: everything above; `setUpLotWorld`, `grantRole`, `completeSignUp`, `signIn`, `clickNav`.
- Produces: no app code.

- [ ] **Step 1: Write the test.** `name-changes.spec.ts` (locators scoped to `getByRole("main")`; warm `/account/name`, `/admin/names` and one `/admin/names/<id>` in setup because the first visit in `next dev` can exceed 15 s): set up the lot world (cooperative with account name "<COOP> COOPERATIVE"), sign up an admin, grant ADMIN and enrol two-factor; the farmer opens `/farmer`, follows "Change my name", fills "<name> Musa", a reason, "Affidavit" and the PDF, submits and sees "Waiting for an admin"; on `/farmer` the bank form shows the "name change is waiting" message; the officer enrols two-factor, opens the cooperative page, requests a rename with an amended certificate; the admin opens "Name changes" from the nav, sees both, opens the person's request, sees "does not match", approves; opens the cooperative's request and rejects it with "Certificate is unreadable"; opens `/admin/cooperatives/<id>` and sees the cooperative's account name; the farmer reloads `/account/name` and sees the new name and "Approved"; the officer sees "Not approved: Certificate is unreadable".
- [ ] **Step 2: Run** `npx playwright test --config .superpowers/playwright.nc.ts tests/e2e/name-changes.spec.ts --workers=1` (never at the same time as the integration suite; if port 3100 is in use by another session, wait). Expected: PASS once Tasks 1 to 6 are in; if it fails, fix the app, not the test.
- [ ] **Step 3: Write** the doc edits.
- [ ] **Step 4: Run** the whole Playwright suite with the same config, then `npm test` (private config), `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `test: name change journey end to end; docs for name changes`.

**Done when:** the whole branch passes a fresh review, and on staging (after the migration is applied) a farmer's name change is approved by an admin, the farmer's bank account is untouched, and a bank change was refused while the request waited. Then open the PR "Admin-approved name changes" to `main`, listing every decision above under "Choices to check" and the migration `name_change_requests` to apply to staging and production.
