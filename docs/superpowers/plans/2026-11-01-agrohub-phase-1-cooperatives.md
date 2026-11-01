# AgroHub Phase 1: Cooperatives, Verification and Farmers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cooperative signs up, uploads its documents and bank account, is verified by an admin, and invites farmers who register, add a bank account and are approved by an officer, with every action authorized, audited and covered by the policy matrix.

**Architecture:** New modules `src/modules/cooperatives` and `src/modules/farmers`, plus the identity changes Phase 0's final review deferred (membership status, `getActor` with 2FA, views, an error-to-response mapper). Infrastructure adapters `src/lib/storage.ts` (S3-compatible private bucket) and `src/lib/paystack.ts` (thin client), each with a fake used locally and in tests, like `src/lib/email.ts`. Pages call server actions; server actions call services; services call `can()` first.

**Tech Stack:** As Phase 0, plus `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (Cloudflare R2 or AWS S3 through the S3 API). Paystack is called with `fetch`, with no SDK.

**Spec:** `docs/superpowers/specs/2026-10-31-agrohub-design.md` sections 3, 6.1, 6.2, 8, 13 (cleared funds, bank names) and 14 (bank changes, account safety). Roadmap: `2026-10-31-agrohub-roadmap.md` Phase 1.

## Global Constraints

- Money is integer kobo; percentages are integer basis points. No floats.
- Bank account numbers are never stored. Only the Paystack recipient code and the account name are stored.
- Phone is a contact detail visible only to admins. Phone confirmation is attempted; if unavailable, the system falls back silently to email confirmation and records the phone as unconfirmed for admins.
- Documents live in a private bucket and are opened only through short-lived signed links.
- Only verified cooperatives can list or sell. A one-person cooperative is allowed and goes through the same check.
- A farmer belongs to one cooperative. Leaving is blocked while any order on their lots is unfinished. Their records are kept for accounting.
- Changing bank details needs email confirmation, officers need two-factor authentication, the change takes effect after 48 hours, admins are alerted, and payouts released during the wait go to the old account.
- Bank account names are checked against the registered name before a transfer recipient is created.
- Verification lapses when the registration certificate expires. Cooperatives re-submit each year and admins are reminded.
- The admin verification queue shows waiting time, and cooperatives get status emails.
- Two-factor authentication is mandatory for every admin role.
- Every service function takes an `Actor` and checks `can(actor, action, resource)` first. Cooperative data is always scoped by `cooperativeId`.
- Private fields (phone numbers, bank data) leave the server only through mapper functions in `views.ts`.
- Approvals, role changes, bank changes and admin actions write to the audit log. Audit `meta` never holds personal data (ids, statuses and reasons only).
- All user-facing strings are in `messages/*.json`, with keys mirrored in all five files.
- Staging uses Paystack test keys only. Never log secrets, account numbers or full request bodies.
- No new dependency without a line in `docs/architecture.md` section 12.
- Migrations that touch `membership` are hand-edited `--create-only` migrations. Never use `prisma db push`.

## Review Focus

1. A regenerated invite link is used after it was revoked: the join is refused and nothing is created (Task 7, `revoked_invite_link_is_refused`).
2. A bank change is confirmed and a payout falls due within 48 hours: the old recipient is still the effective one (Task 6, `bank_change_takes_effect_after_48_hours`; Phase 5 consumes `effectiveRecipientCode`).
3. A farmer who is pending or active in one cooperative opens another cooperative's link: refused. A farmer who left can join another (Task 8, `farmer_cannot_join_second_cooperative`, `farmer_who_left_can_join_another`).
4. A link of an unverified or suspended cooperative is opened: the join is refused with a clear message (Task 7, `unverified_cooperative_link_refuses_join`).
5. Phone numbers, document URLs or recipient codes reach a non-admin or another cooperative (Task 4, `document_url_denied_to_other_cooperatives`; Task 8, `phone_visible_to_admins_only`).

## Decisions this plan makes (the spec is silent)

- **Phone confirmation.** SMS is a launch non-goal, so there is no SMS provider. Every phone is stored with `phoneConfirmed = false` and shown to admins as unconfirmed. Email verification (Phase 0) is the confirmation that happens.
- **Bank changes.** The first bank account a cooperative or farmer adds takes effect immediately. Only later changes go through the 48-hour wait.
- **Invite links.** Joining requires the cooperative to be `VERIFIED`.
- **Rejection.** A rejected cooperative stays `PENDING`, with a `reviewNote` and `submittedAt` cleared, so it can re-submit. Cooperative states stay exactly PENDING, VERIFIED, SUSPENDED (architecture section 6).
- **Lapsed verification.** It moves the cooperative from VERIFIED to PENDING.
- **Farmer profile values.** Crops are free-text strings until Phase 2 adds the crop list. The state is one of the 36 states plus FCT. The LGA is free text. Farm size is `Decimal(8,2)` hectares; it is not money, so the no-float rule doesn't apply.
- **Unfinished-orders block.** The block on leaving and removal is a function `hasUnfinishedOrders(farmerUserId): Promise<boolean>` in `src/modules/farmers/orders-guard.ts`. It returns `false` until Phase 5 implements it.
- **New users have no Actor.** The two self-onboarding functions, `createCooperative` and `joinViaLink`, take `{ userId }`, because a new user has no membership and so no Actor. Each carries a comment stating the exemption.
- **Additional officers.** Adding more officers to a cooperative is out of scope; the admin bootstrap script grants roles meanwhile.

---

### Task 1: Membership status, Actor with 2FA, and request plumbing

**Files:**
- Modify: `prisma/schema.prisma` (enum `MembershipStatus { PENDING ACTIVE REMOVED LEFT }`, `Membership.status` default `ACTIVE`, `Membership.approvedAt DateTime?`, `User.phoneConfirmed Boolean @default(false)`)
- Create: new `--create-only` migration that adds the columns, then drops and re-creates the two partial unique indexes as `WHERE role = 'FARMER' AND status IN ('PENDING','ACTIVE')` (and the same for OFFICER). Keep the names and leave `membership_user_role_cooperative_key` untouched.
- Modify: `src/modules/identity/policies.ts`, `src/modules/identity/service.ts`, `src/lib/errors.ts`, `src/app/layout.tsx`, `src/app/actions/active-role.ts`
- Create: `src/modules/identity/session.ts`, `src/modules/identity/views.ts`, `src/lib/action-result.ts`
- Test: `tests/integration/membership.test.ts`, `tests/integration/get-actor.test.ts`, `tests/unit/action-result.test.ts`, `tests/access/policy-matrix.test.ts` (fixtures gain `twoFactorEnabled`)

**Interfaces:**
- Produces:
  - `Actor = { userId: string; role: Role; cooperativeId: string | null; twoFactorEnabled: boolean }`.
  - `UnauthenticatedError` in `errors.ts`, mirroring `ForbiddenError`, with code `'UNAUTHENTICATED'`.
  - `NotFoundError(code)`.
  - `getActor(): Promise<Actor | null>` in `session.ts`. It reads the Better Auth session, lists **ACTIVE** memberships, picks one with `pickActiveMembership` using the `activeMembershipId` cookie, then calls `requireSecondFactor({ role, twoFactorVerified: user.twoFactorEnabled === true })`. It returns null with no session or no active membership.
  - `requireActor(): Promise<Actor>` throws `UnauthenticatedError` when there is no Actor.
  - `currentUser(): Promise<{ userId: string; email: string; twoFactorEnabled: boolean } | null>`.
  - `toActionResult(error: unknown): { ok: false; code: string }` in `action-result.ts`: typed errors → their `code`, anything else → `'INTERNAL'`, and it never leaks the message. Server actions return `{ ok: true, data } | { ok: false, code }`.
  - `toSwitcherMembership(m: Membership): { id: string; role: Role; cooperativeId: string | null }` in `views.ts`.
  - `addMembership` gains `status?: MembershipStatus` (default `ACTIVE`) and writes `recordAudit({ action: 'membership.grant', entity: 'membership', entityId, meta: { role, status } })`.
  - `listMemberships(userId)` returns ACTIVE memberships only.

- [ ] **Step 1: Write the failing tests.**
  - `membership.test.ts`:
    - a farmer whose FARMER membership is `LEFT` can be granted a FARMER membership in another cooperative;
    - a second `PENDING` FARMER membership is a `ConflictError`;
    - `addMembership` writes exactly one `audit_log` row with action `membership.grant`.
  - `get-actor.test.ts`, mocking `@/lib/auth` `auth.api.getSession` and `next/headers`:
    - no session → `null`;
    - an ADMIN with `twoFactorEnabled: false` → rejects with `ForbiddenError` code `2FA_REQUIRED`;
    - an ADMIN with it enabled → an Actor with `twoFactorEnabled: true`;
    - a cookie naming another user's membership is ignored (the priority pick is used);
    - a user with only a `PENDING` membership → `null`.
  - `action-result.test.ts`: `toActionResult(new ForbiddenError('X'))` equals `{ ok: false, code: 'X' }`, and `toActionResult(new Error('db password ...'))` equals `{ ok: false, code: 'INTERNAL' }`.
- [ ] **Step 2: Run** `npm test -- tests/integration/membership.test.ts tests/integration/get-actor.test.ts tests/unit/action-result.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema and migration (`npx prisma migrate dev --create-only --name membership_status`, then hand-edit). Implement `session.ts`, `views.ts`, `action-result.ts` and the error classes. Switch `layout.tsx` to `toSwitcherMembership`. Make `setActiveRole` use `env.APP_ENV` (already does) and return an action result. Add a `signOut` server action that deletes the `activeMembershipId` cookie and calls `auth.api.signOut`. Add a comment on `listMemberships` and `getOwnedMembership` saying they are self-scoped lookups that precede an Actor.
- [ ] **Step 4: Run** the same command, then `npx prisma migrate dev` (it must report "Already in sync"), then `npm test`, `npm run typecheck` and `npm run lint`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: membership status, getActor with 2FA, action results`

### Task 2: Sign-up, sign-in, 2FA pages and admin bootstrap

**Files:**
- Create: `src/app/(auth)/sign-up/page.tsx`, `src/app/(auth)/sign-in/page.tsx`, `src/app/(auth)/verified/page.tsx`, `src/app/(auth)/two-factor/page.tsx`, `src/lib/auth-client.ts`, `scripts/grant-role.ts`
- Modify: `src/lib/auth.ts` (`emailVerification.callbackURL` → `/verified`, the `nextCookies` plugin), `package.json` (`"admin:grant": "tsx scripts/grant-role.ts"`), `messages/*.json`, `docs/environments.md`
- Test: `tests/e2e/auth.spec.ts` (Playwright), `tests/integration/grant-role.test.ts`

**Interfaces:**
- Consumes: `getActor`, `addMembership`, `recordAudit` from Task 1.
- Produces:
  - `grantRole(input: { email: string; role: 'ADMIN' | 'BOARD_ADMIN' }): Promise<Membership>`, exported from `scripts/grant-role.ts` for the test. The CLI is `npm run admin:grant -- <email> <ADMIN|BOARD_ADMIN>`. It refuses unknown emails with exit code 1, and the DB URL must be passed inline (documented).
  - The pages use Better Auth's client (`createAuthClient` with `twoFactorClient`).
  - An admin whose `getActor` throws `2FA_REQUIRED` is redirected to `/two-factor`. That page enrolls TOTP (QR plus a verification code) or verifies a code at sign-in.

- [ ] **Step 1: Write the failing tests.**
  - `grant-role.test.ts`:
    - `grantRole({ email, role: 'ADMIN' })` for an existing user creates one ACTIVE ADMIN membership and one `membership.grant` audit row;
    - an unknown email rejects with `NotFoundError` code `USER_NOT_FOUND`.
  - `auth.spec.ts`, run against `next dev` with the Playwright `webServer` env:
    - sign up with name, email, password, phone and the consent checkbox → the page says "Check your email";
    - opening the verification link from the fake outbox lands on `/verified`;
    - signing in with the wrong password shows the `auth.signIn.invalid` message.
    - Read the fake outbox through a dev-only route `GET /api/dev/outbox`, which returns 404 unless `APP_ENV` is `local`.
- [ ] **Step 2: Run** `npm test -- tests/integration/grant-role.test.ts`, then `npx playwright install chromium && npx playwright test tests/e2e/auth.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the pages (mobile-first, token styling, strings from messages), the client, the dev outbox route and the script. Add `tsx` as a dev dependency with a line in `architecture.md`.
- [ ] **Step 4: Run** the same commands. Expected: PASS. Then run `npm test`, `npm run typecheck` and `npm run lint`.
- [ ] **Step 5: Commit** `feat: sign-up, sign-in and 2FA pages; admin grant script`

### Task 3: Private storage adapter

**Files:**
- Create: `src/lib/storage.ts`, `src/app/api/dev-storage/[...key]/route.ts`, `tests/unit/storage.test.ts`
- Modify: `src/lib/env.ts` (optional `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_REGION` default `'auto'`), `.env.example`, `docs/architecture.md`, `docs/environments.md`

**Interfaces:**
- Produces:
  - `putPrivate(key: string, body: Buffer, contentType: string): Promise<void>`.
  - `signedUrl(key: string, ttlSeconds: number): Promise<string>`.
  - `fakeStorage: { objects: Map<string, { body: Buffer; contentType: string }>; clear(): void }`.
  - Transport selection mirrors `email.ts`:
    - the fake is used when `APP_ENV === 'local'` or `NODE_ENV === 'test'`;
    - S3 is used otherwise;
    - staging or production with any storage variable missing throws at call time.
  - Locally, `signedUrl` returns `/api/dev-storage/<key>?exp=<unix>&sig=<hmac-sha256(key+exp, BETTER_AUTH_SECRET)>`. The dev route serves the fake object only in `local`, with a valid signature and a time before `exp`; otherwise 404 or 403.

- [ ] **Step 1: Write the failing tests.**
  - `putPrivate` then `fakeStorage.objects.get(key)` round-trips the body and content type.
  - A local signed URL whose `exp` has passed is rejected by the route handler (403), and an altered `sig` is rejected (403).
  - `selectStorage({ appEnv: 'staging', ... all missing })` throws `STORAGE_NOT_CONFIGURED`.
  - A mocked `@aws-sdk/s3-request-presigner` `getSignedUrl` receives `expiresIn: 300` for `signedUrl(k, 300)`.
- [ ] **Step 2: Run** `npm test -- tests/unit/storage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** using `S3Client` (`forcePathStyle: true` for R2), `PutObjectCommand` and `GetObjectCommand` with `getSignedUrl`. Compare signatures with `timingSafeEqual`.
- [ ] **Step 4: Run** the test and the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: private storage adapter with signed links`

### Task 4: Cooperative sign-up and documents

**Files:**
- Modify: `prisma/schema.prisma`:
  - `enum CooperativeStatus { PENDING VERIFIED SUSPENDED }`;
  - `model Cooperative { id, name, registrationNumber @unique, state, lga, status @default(PENDING), certificateExpiresAt DateTime, submittedAt DateTime?, verifiedAt DateTime?, reviewNote String?, recipientCode String?, accountName String?, createdAt }`;
  - `enum DocumentKind { REGISTRATION_CERTIFICATE BYLAWS OFFICER_LIST }`;
  - `model CooperativeDocument { id, cooperativeId, kind, storageKey, contentType, sizeBytes Int, uploadedBy, createdAt }`;
  - `Membership.cooperativeId` becomes a relation to `Cooperative` (hand-edit the migration so the NULLS NOT DISTINCT constraint is not recreated).
- Create: `src/modules/cooperatives/{service,schema,views}.ts`, `src/modules/geo/states.ts` (the 36 states plus `FCT`), `src/app/officer/onboarding/page.tsx`, `src/app/officer/actions.ts`
- Modify: `src/modules/identity/policies.ts` (actions `cooperative:read`, `cooperative:upload`, `document:view`), `messages/*.json`
- Test: `tests/integration/cooperatives.test.ts`, `tests/access/policy-matrix.test.ts`

**Interfaces:**
- Consumes: `putPrivate` and `signedUrl` (Task 3), `addMembership`, `requireActor`, `Actor` and `recordAudit`.
- Produces:
  - `createCooperative(user: { userId: string }, input: { name; registrationNumber; state; lga; certificateExpiresAt: Date }): Promise<Cooperative>`. It creates the cooperative plus an ACTIVE OFFICER membership in one transaction. A user who already has an ACTIVE or PENDING OFFICER membership gets `ConflictError('ALREADY_OFFICER')`.
  - `uploadDocument(actor, cooperativeId, file: { kind: DocumentKind; body: Buffer; contentType: string }): Promise<CooperativeDocument>`:
    - allowed types are `application/pdf`, `image/jpeg` and `image/png`;
    - the maximum size is 10 485 760 bytes, otherwise `ValidationError`;
    - the storage key is `cooperatives/<id>/<kind>/<cuid>`;
    - when all three kinds are present, it sets `submittedAt` to now if that was null.
  - `getDocumentUrl(actor, documentId): Promise<string>` returns `signedUrl(key, 300)`.
  - `toOfficerCooperative(c)` and `toAdminCooperative(c, docs)` in views: neither includes `recipientCode`, and only the admin view includes `reviewNote` and waiting days.
  - Policy:
    - `cooperative:upload` and `cooperative:read`: an OFFICER of their own cooperative, or an ADMIN for `read`.
    - `document:view`: an ADMIN, or an OFFICER of their own cooperative.

- [ ] **Step 1: Write the failing tests.**
  - `createCooperative` makes one PENDING cooperative and one ACTIVE OFFICER membership.
  - A second call by the same user → `ALREADY_OFFICER`.
  - Upload rules:
    - an upload of `text/html` → `ValidationError`;
    - 10 485 761 bytes → `ValidationError`;
    - after three uploads of the three kinds, `submittedAt` is set;
    - a re-upload doesn't change it.
  - `document_url_denied_to_other_cooperatives`: an officer of cooperative B calling `getDocumentUrl` for A's document → `ForbiddenError`.
  - An ADMIN gets a URL.
  - Policy matrix rows for the three new actions across all five roles.
- [ ] **Step 2: Run** `npm test -- tests/integration/cooperatives.test.ts tests/access/policy-matrix.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema and migration (`--create-only`, hand-checked), the services, and the onboarding page. The page has a form for the cooperative fields, then three file inputs that post through server actions using `FormData`, and shows status: "Waiting for review since <date>".
- [ ] **Step 4: Run** the same command, `npx prisma migrate dev` (no drift), then the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: cooperative sign-up and private documents`

### Task 5: Admin verification queue

**Files:**
- Modify: `src/modules/cooperatives/service.ts`, `src/modules/identity/policies.ts` (actions `cooperative:suspend` and `cooperative:queue`; `cooperative:verify` exists), `messages/*.json`
- Create: `src/modules/notifications/emails.ts`, `src/app/admin/cooperatives/page.tsx`, `src/app/admin/cooperatives/[id]/page.tsx`, `src/app/admin/actions.ts`
- Test: `tests/integration/verification.test.ts`, `tests/unit/emails.test.ts`, policy matrix

**Interfaces:**
- Consumes: `sendEmail`, `fakeOutbox`, `recordAudit` and Task 4's views.
- Produces:
  - `listVerificationQueue(actor, now: Date): Promise<Array<AdminCooperative & { waitingDays: number }>>`. It returns PENDING cooperatives with `submittedAt` not null, oldest first. `waitingDays` is `floor((now - submittedAt) / 86 400 000)`.
  - `verifyCooperative(actor, id)` moves PENDING to VERIFIED and sets `verifiedAt`. It requires `submittedAt` and `certificateExpiresAt > now`, otherwise `ValidationError('CERTIFICATE_EXPIRED')`.
  - `rejectCooperative(actor, id, reason: string)` requires a reason of 1–500 characters. It sets `reviewNote` and clears `submittedAt`, and the status stays PENDING.
  - `suspendCooperative(actor, id, reason)` moves VERIFIED to SUSPENDED.
  - `reinstateCooperative(actor, id)` moves SUSPENDED to VERIFIED.
  - Any other transition gives `ConflictError('ILLEGAL_TRANSITION')`.
  - Each transition writes an audit row (`cooperative.verify`, `.reject`, `.suspend`, `.reinstate`, with `meta: { from, to }`) and emails every ACTIVE officer of the cooperative.
  - `emails.ts` exports `cooperativeStatusEmail(kind: 'verified' | 'rejected' | 'suspended' | 'reinstated', input: { cooperativeName: string; reason?: string }): { subject: string; html: string }`. The copy is English, with no "escrow". The reason is HTML-escaped.
  - The admin pages call `requireActor()`, so an ADMIN without 2FA is redirected to `/two-factor`. The detail page shows document links from `getDocumentUrl`.

- [ ] **Step 1: Write the failing tests.**
  - `verification.test.ts`:
    - the queue orders by `submittedAt`;
    - `waitingDays` is `3` for a cooperative submitted 3 days and 2 hours earlier;
    - verify puts exactly one email in the outbox per active officer;
    - verifying an expired certificate → `CERTIFICATE_EXPIRED`;
    - rejecting with an empty reason → `ValidationError`;
    - suspending a PENDING cooperative → `ILLEGAL_TRANSITION`;
    - an OFFICER calling `verifyCooperative` → `ForbiddenError`;
    - each transition writes one audit row with the right action.
  - `emails.test.ts`: the reason `<script>` is escaped, and no template contains "escrow" (case-insensitive).
- [ ] **Step 2: Run** `npm test -- tests/integration/verification.test.ts tests/unit/emails.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the services and pages. The queue is a list with name, state and "Waiting N days"; the detail page has documents and the four actions with a reason field.
- [ ] **Step 4: Run** the tests and the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: admin verification queue and status emails`

### Task 6: Paystack recipients and bank details with a 48-hour change window

**Files:**
- Create: `src/lib/paystack.ts`, `src/modules/banking/{service,names,views}.ts`, `src/app/bank/confirm/page.tsx`
- Modify: `prisma/schema.prisma` (`model BankChangeRequest { id, ownerType: 'COOPERATIVE' | 'FARMER' (enum BankOwnerType), ownerId, newRecipientCode, newAccountName, requestedBy, confirmToken @unique, confirmedAt DateTime?, effectiveAt DateTime?, cancelledAt DateTime?, createdAt }`), `src/lib/env.ts` (optional `PAYSTACK_SECRET_KEY`; in staging it must start with `sk_test_`, otherwise `parseEnv` throws), `src/modules/identity/policies.ts` (action `bank:change`), `.env.example`, `messages/*.json`
- Test: `tests/unit/paystack.test.ts`, `tests/unit/names.test.ts`, `tests/integration/banking.test.ts`, `tests/unit/env.test.ts`, policy matrix

**Interfaces:**
- Produces:
  - `resolveAccount(input: { accountNumber: string; bankCode: string }): Promise<{ accountName: string }>`, via GET `/bank/resolve`.
  - `createRecipient(input: { accountNumber: string; bankCode: string; name: string }): Promise<{ recipientCode: string; accountName: string }>`, via POST `/transferrecipient` with `type: 'nuban'` and `currency: 'NGN'`.
  - `listBanks(): Promise<Array<{ name: string; code: string }>>`.
  - `fakePaystack: { accounts: Map<string, string>; recipients: string[]; clear(): void }`, used in local and test; it is keyed by `${bankCode}:${accountNumber}`. Errors become `ValidationError('BANK_ACCOUNT_NOT_FOUND')`, and a Paystack 5xx becomes `Error('PAYSTACK_UNAVAILABLE')`. Account numbers are never logged.
  - `namesMatch(registered: string, resolved: string): boolean` in `names.ts`. It uppercases, strips punctuation, splits on whitespace, ignores the tokens `LTD`, `LIMITED`, `COOPERATIVE`, `SOCIETY`, `MULTIPURPOSE` and `NIG`, and is true when every remaining registered token appears in the resolved tokens.
  - `setCooperativeBankAccount(actor, cooperativeId, input: { accountNumber; bankCode }): Promise<{ accountName: string; pending: boolean }>` checks `can(actor, 'bank:change', { cooperativeId })` first.
  - `setOwnFarmerBankAccount(user: { userId: string }, input: { accountNumber; bankCode })` returns the same shape. It is self-scoped to the caller's own `FarmerProfile` with no Actor, because a farmer adds the account while their membership is still PENDING. It carries the same exemption comment as `joinViaLink`.
  - Both delegate to one private `applyBankAccount(owner: { type: BankOwnerType; id: string }, registeredName, requestedBy, input)`:
    - it resolves the account and requires `namesMatch(registeredName, accountName)`, otherwise `ValidationError('ACCOUNT_NAME_MISMATCH')`;
    - the registered name is the cooperative name or the farmer user's name;
    - it creates the recipient;
    - when the owner has no `recipientCode`, it sets the code immediately (`pending: false`);
    - otherwise it creates a `BankChangeRequest`, emails a confirmation link `/bank/confirm?token=…` to the requester, and returns `pending: true`.
  - `confirmBankChange(token: string, now: Date)` sets `confirmedAt = now`, `effectiveAt = now + 48 h`, emails every ADMIN, and writes the audit row `bank.change.confirmed`.
  - `effectiveRecipientCode(owner, at: Date): Promise<string | null>` returns the newest confirmed request with `effectiveAt <= at`, otherwise the owner's stored `recipientCode`. Phase 5 uses it for payouts.
  - The job `bank-change-apply` (defined in `src/lib/jobs/index.ts`) copies due requests onto the owner. It is idempotent because it processes only requests that are not yet applied.
  - Policy: `bank:change` is allowed only for an OFFICER of their own cooperative with `twoFactorEnabled`. Farmers use the self-scoped function above.
  - The job `bank-change-apply` gets the cron entry `{ "path": "/api/cron/bank-change-apply", "schedule": "0 * * * *" }` in `vercel.json`.
  - Views never return the recipient code to non-admins; they show only the bank name and the last name on the account.

- [ ] **Step 1: Write the failing tests.**
  - `names.test.ts`, a table:
    - `('Ogun Farmers Cooperative Society', 'OGUN FARMERS COOP SOC')` → false;
    - `('Ogun Farmers Cooperative', 'OGUN FARMERS MULTIPURPOSE COOPERATIVE SOCIETY LTD')` → true;
    - `('Ada Obi', 'OBI ADA CHIOMA')` → true;
    - `('Ada Obi', 'ADA OKAFOR')` → false.
  - `paystack.test.ts`, mocking `fetch`:
    - the Authorization header is `Bearer <key>`;
    - a 422 response maps to `BANK_ACCOUNT_NOT_FOUND`;
    - a thrown error's message never contains the account number.
  - `env.test.ts`: staging with `PAYSTACK_SECRET_KEY: 'sk_live_x'` throws `PAYSTACK_SECRET_KEY`.
  - `banking.test.ts`:
    - the first set is immediate;
    - a second set is pending;
    - before confirmation, `effectiveRecipientCode` is the old code;
    - `bank_change_takes_effect_after_48_hours`: confirm at T, then at `T + 47h59m` it is the old code and at `T + 48h` the new one;
    - confirming puts one email per admin in the outbox;
    - an OFFICER without 2FA gets `ForbiddenError`;
    - a name mismatch → `ACCOUNT_NAME_MISMATCH`;
    - the stored `BankChangeRequest` row has no account-number column.
- [ ] **Step 2: Run** `npm test -- tests/unit/names.test.ts tests/unit/paystack.test.ts tests/integration/banking.test.ts tests/unit/env.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the client, services, job, confirm page and bank forms (the officer onboarding page gets a bank form). The bank list comes from `listBanks` and is cached for a day.
- [ ] **Step 4: Run** the tests and the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Paystack recipients and 48-hour bank change window`

### Task 7: Invite links

**Files:**
- Modify: `prisma/schema.prisma` (`model InviteLink { id, cooperativeId, token String @unique, email String?, createdBy, revokedAt DateTime?, usedAt DateTime?, createdAt }`), `src/modules/cooperatives/service.ts`, `src/modules/identity/policies.ts` (action `invite:manage`), `messages/*.json`
- Create: `src/modules/cooperatives/invites.ts`, `src/app/officer/invites/page.tsx`
- Test: `tests/integration/invites.test.ts`, policy matrix

**Interfaces:**
- Produces:
  - `createInviteLink(actor, cooperativeId): Promise<{ url: string }>`. It returns the current open shareable link (`email` null) or creates one. The token is 32 random bytes, base64url. The URL is `${env.BETTER_AUTH_URL}/join/<token>`.
  - `regenerateInviteLink(actor, cooperativeId)` sets `revokedAt` on every open shareable link and creates a new one.
  - `inviteFarmerByEmail(actor, cooperativeId, email)` creates a single-use link bound to that email and emails it.
  - `resolveInvite(token, now): Promise<{ cooperativeId: string; cooperativeName: string; email: string | null }>` throws `NotFoundError('INVITE_INVALID')` when the token is revoked, used or unknown. It throws `ForbiddenError('COOPERATIVE_NOT_VERIFIED')` unless the cooperative is VERIFIED.
  - Policy: `invite:manage` is allowed for an OFFICER of their own cooperative.

- [ ] **Step 1: Write the failing tests.**
  - `createInviteLink` called twice returns the same URL.
  - `revoked_invite_link_is_refused`: after `regenerateInviteLink`, `resolveInvite(oldToken)` → `INVITE_INVALID`, and the new token resolves.
  - `unverified_cooperative_link_refuses_join`: a PENDING cooperative's token → `COOPERATIVE_NOT_VERIFIED`, and a SUSPENDED one does the same.
  - An email invite puts one email in the outbox containing the URL.
  - An officer of another cooperative gets `ForbiddenError`.
- [ ] **Step 2: Run** `npm test -- tests/integration/invites.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the services and the officer invites page: copy link, regenerate (with confirmation), and invite by email.
- [ ] **Step 4: Run** the tests and the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: cooperative invite links`

### Task 8: Farmer registration by invite

**Files:**
- Modify: `prisma/schema.prisma` (`model FarmerProfile { id, userId @unique, cooperativeId, farmSizeHectares Decimal @db.Decimal(8,2), crops String[], state, lga, recipientCode String?, accountName String?, createdAt, updatedAt }`), `messages/*.json`
- Create: `src/modules/farmers/{service,schema,views}.ts`, `src/modules/farmers/orders-guard.ts`, `src/app/join/[token]/page.tsx`, `src/app/farmer/page.tsx`, `src/app/farmer/actions.ts`
- Test: `tests/integration/farmer-join.test.ts`, `tests/unit/farmer-views.test.ts`

**Interfaces:**
- Consumes: `resolveInvite` (Task 7), `addMembership` (Task 1, `status: 'PENDING'`), `setOwnFarmerBankAccount` (Task 6).
- Produces:
  - `joinViaLink(user: { userId: string }, token: string, profile: { farmSizeHectares: string; crops: string[]; state: string; lga: string }, now: Date): Promise<{ membershipId: string }>`:
    - it validates with zod: farm size `> 0` and `<= 100000` with at most 2 decimals; 1–20 crops of 1–60 characters each; a state from `geo/states.ts`; an LGA of 1–80 characters;
    - when the invite is email-bound, the user's email must match, otherwise `ForbiddenError('INVITE_EMAIL_MISMATCH')`;
    - it creates the PENDING FARMER membership and the profile, and marks a single-use invite `usedAt`;
    - an existing PENDING or ACTIVE FARMER membership → `ConflictError('ALREADY_IN_COOPERATIVE')`.
  - `hasUnfinishedOrders(farmerUserId: string): Promise<boolean>` returns `false`, with a comment saying Phase 5 implements it.
  - `toOfficerFarmer(profile, user)` has no `phone`, `recipientCode` or `email`. `toAdminFarmer(profile, user)` includes `phone` and `phoneConfirmed`.
  - The join page: if the user is signed out, show sign-up/sign-in that returns to `/join/<token>`; then the profile form; then the bank form (`setOwnFarmerBankAccount`, which must succeed before the farmer can list in Phase 3; this is shown on `/farmer`). The page shows "Waiting for your officer's approval".

- [ ] **Step 1: Write the failing tests.**
  - Joining creates one PENDING membership and one profile.
  - `farmer_cannot_join_second_cooperative`: PENDING in A, joining B → `ALREADY_IN_COOPERATIVE`.
  - `farmer_who_left_can_join_another`: a `LEFT` membership in A, joining B succeeds.
  - An email-bound invite opened by another email → `INVITE_EMAIL_MISMATCH`.
  - A used single-use invite → `INVITE_INVALID`.
  - A farm size of `"1.234"` → `ValidationError`, and the state `"Lagoss"` → `ValidationError`.
  - `phone_visible_to_admins_only`: `JSON.stringify(toOfficerFarmer(...))` does not contain the phone value, and `toAdminFarmer` does.
- [ ] **Step 2: Run** `npm test -- tests/integration/farmer-join.test.ts tests/unit/farmer-views.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the services and pages.
- [ ] **Step 4: Run** the tests and the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: farmer registration by invite link`

### Task 9: Officer approval queue, removal and leaving

**Files:**
- Modify: `src/modules/farmers/service.ts`, `src/modules/identity/policies.ts` (actions `farmer:remove` and `farmer:leave`; `farmer:approve` exists), `messages/*.json`
- Create: `src/app/officer/farmers/page.tsx`
- Test: `tests/integration/farmer-approval.test.ts`, policy matrix

**Interfaces:**
- Produces:
  - `listPendingFarmers(actor, cooperativeId): Promise<OfficerFarmer[]>`.
  - `approveFarmer(actor, membershipId)`: PENDING → ACTIVE, sets `approvedAt`, writes the audit row `farmer.approve`, and emails the farmer.
  - `rejectFarmer(actor, membershipId, reason)`: PENDING → REMOVED, with an audit row and an email.
  - `removeFarmer(actor, membershipId, reason)`: ACTIVE → REMOVED. It requires `!(await hasUnfinishedOrders(userId))`, otherwise `ConflictError('UNFINISHED_ORDERS')`. It writes an audit row.
  - `leaveCooperative(actor)`: the farmer's own ACTIVE membership → LEFT, with the same guard and an audit row.
  - The membership and profile rows are kept.
  - Policy:
    - `farmer:remove`: an OFFICER of their own cooperative.
    - `farmer:leave`: a FARMER with `ownerUserId === actor.userId`.

- [ ] **Step 1: Write the failing tests.**
  - Approve moves PENDING to ACTIVE and puts one email in the outbox.
  - Approving an ACTIVE membership → `ConflictError('ILLEGAL_TRANSITION')`.
  - An officer of cooperative B approving A's farmer → `ForbiddenError`.
  - With `hasUnfinishedOrders` mocked to `true`, removal → `UNFINISHED_ORDERS` and leaving does the same.
  - After leaving, the profile row still exists, and `getActor` for that user returns `null` with no other memberships.
  - Matrix rows for the new actions.
- [ ] **Step 2: Run** `npm test -- tests/integration/farmer-approval.test.ts tests/access/policy-matrix.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the services and the officer farmers page (a pending list with approve/reject, an active list with remove) and the leave button on `/farmer`.
- [ ] **Step 4: Run** the tests and the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: officer farmer approval, removal and leaving`

### Task 10: Certificate expiry and re-verification reminders

**Files:**
- Create: `src/modules/cooperatives/expiry.ts`
- Modify: `src/lib/jobs/index.ts` (register `certificate-expiry`), `vercel.json` (cron `{ "path": "/api/cron/certificate-expiry", "schedule": "0 6 * * *" }`), `src/modules/notifications/emails.ts`
- Test: `tests/integration/certificate-expiry.test.ts`

**Interfaces:**
- Consumes: `runOnce`, `defineJob`, `sendEmail` and `recordAudit`.
- Produces: `runCertificateExpiry(now: Date): Promise<{ lapsed: number; reminded: number }>`:
  - VERIFIED cooperatives with `certificateExpiresAt <= now` move to PENDING, with `submittedAt` cleared and `reviewNote` set to `'CERTIFICATE_EXPIRED'`, an audit row `cooperative.lapse`, and an officer email.
  - VERIFIED cooperatives expiring within 30 days get one reminder email to their officers, wrapped in `runOnce('cert-reminder:<cooperativeId>:<certificateExpiresAt ISO date>')`. Each ADMIN gets one daily digest listing them, wrapped in `runOnce('cert-digest:<YYYY-MM-DD>')`.

- [ ] **Step 1: Write the failing tests.**
  - A cooperative expiring yesterday lapses to PENDING, with one officer email and one audit row.
  - A cooperative expiring in 10 days gets exactly one reminder across two runs on the same day and the next day.
  - A cooperative expiring in 40 days gets none.
  - A lapse frees `submittedAt`, so a re-upload re-submits it.
- [ ] **Step 2: Run** `npm test -- tests/integration/certificate-expiry.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the job and cron entry.
- [ ] **Step 4: Run** the tests and the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: certificate expiry and re-verification reminders`

### Task 11: End-to-end journey and staging setup

**Files:**
- Create: `tests/e2e/cooperative-to-farmer.spec.ts`, `prisma/seed.ts`
- Modify: `docs/environments.md` (the R2 bucket, the storage and Paystack variables per environment, and the `admin:grant` procedure), `.github/workflows/ci.yml` (Playwright job: install chromium, run e2e against `next dev` with the test env), `docs/superpowers/plans/2026-10-31-agrohub-roadmap.md` (tick Phase 1)

**Interfaces:**
- Consumes everything above.
- Produces: `npm run db:seed` for local and staging. It creates one admin with TOTP-enabled flags off, so `/two-factor` enrolment is exercised. It also creates one verified cooperative with an officer, and one pending farmer. It never runs when `APP_ENV` is `production`.

- [ ] **Step 1: Write the failing e2e test** `cooperative-to-farmer.spec.ts`:
  1. An officer signs up, verifies email via `/api/dev/outbox`, creates a cooperative, uploads three small PDFs, and adds a bank account. The fake Paystack is seeded with a matching name.
  2. An admin, granted via `grantRole` in test setup, signs in, enrols 2FA (the TOTP code is computed in the test from the secret shown), and verifies the cooperative.
  3. The officer copies the invite link.
  4. A farmer opens it, signs up, completes the profile and bank, and sees "Waiting for approval".
  5. The officer approves.
  6. The farmer reloads and sees the approved state.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/cooperative-to-farmer.spec.ts`. Expected: FAIL until every task is in place, then PASS.
- [ ] **Step 3: Implement** the seed, the CI job and the docs.
- [ ] **Step 4: Run** the full checks and e2e. Expected: PASS. Then, by hand: create the R2 bucket and set the storage variables and `PAYSTACK_SECRET_KEY` (test key) on Vercel Preview, run `prisma migrate deploy` against staging, deploy, and repeat the journey on the staging preview.
- [ ] **Step 5: Commit** `test: end-to-end cooperative to farmer journey; staging docs`

---

## Self-review

- **Spec coverage:**
  - 6.1 is covered by Tasks 4, 5, 6 and 10 (sign-up, documents, review, bank, suspension, lapse).
  - 6.2 is covered by Tasks 7, 8 and 9 (invite links regenerated or direct, registration, consent from Phase 0, bank, approval, profile, phone fallback, one cooperative, leaving).
  - Section 14 bank changes and account safety are covered by Task 6; account suspension by admins is out of scope (Phase 9 security review).
  - Section 13, bank name check, is covered by Task 6. Section 8, audit and 2FA, is covered by Tasks 1, 2 and 5.
  - Phase 0's deferred prerequisites (`getActor` with 2FA, `views.ts`, auditing membership grants, `UnauthenticatedError`, clearing the cookie on sign-out) are covered by Task 1.
- **Type consistency:**
  - `Actor` gains `twoFactorEnabled` in Task 1 and is used unchanged afterwards.
  - `MembershipStatus` is defined in Task 1.
  - `BankOwnerType` is defined in Task 6 and used in Task 8.
  - `resolveInvite` is defined in Task 7 and consumed in Task 8.
  - `hasUnfinishedOrders` is defined in Task 8 and consumed in Task 9.
- **Deferred:** the real `hasUnfinishedOrders` (Phase 5), crop list linkage (Phase 2), photo compression (Phase 3), additional officers, and admin account suspension.
