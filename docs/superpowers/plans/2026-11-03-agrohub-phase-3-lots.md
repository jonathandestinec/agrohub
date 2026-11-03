# AgroHub Phase 3: Harvest Lots and Officer Screening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A farmer submits a harvest lot (crop, unit, quantity, grade, pickup place, photos, asking price, private floor, note) after seeing their take-home and a neutral board-price warning; an officer of the same cooperative (or an admin when there is no other officer) approves, rejects or counters it; on approval the lot goes live with its fee terms locked, and no public output ever carries the floor.

**Architecture:** Platform settings (AgroHub fee, maximum cooperative cut, deviation threshold) live in a new `Setting` table read through `src/modules/settings/service.ts`. Lots, contributions, photos, fee terms and revisions belong to `src/modules/catalog` (architecture section 2); the lot functions live in `catalog/lots.ts` and are exported only through `catalog/service.ts`. Board reference prices come from `board/service.ts`; the pure checks (`saleBreakdown` in `src/lib/money.ts`, `askDeviation` in `board/deviation.ts`) also run in the browser for the live preview. Farmer screens under `src/app/farmer/lots/`, officer screens under `src/app/officer/lots/`, the admin fallback queue and settings under `src/app/admin/`, the public list at `src/app/lots/`. Every screen uses the redesign kit (`src/components/ui/`).

**Tech Stack:** As Phase 2. No new dependencies: photos are compressed in the browser with `<canvas>`.

**Spec:** `docs/superpowers/specs/2026-10-31-agrohub-design.md` sections 2 (anti-goals), 3 (officer self-approval), 6.1 (suspension hides lots), 6.3, 7 (money rules), 9 (photos compressed, drafts kept), 13 (available-until, minimum order quantity), 14 (edit and withdraw, scheduled jobs). Roadmap: `2026-10-31-agrohub-roadmap.md` Phase 3 (3.1 to 3.8). Architecture: `docs/architecture.md` sections 2, 3, 5, 6 (Lot state machine), 8 (cron), 11.

## Global Constraints

- Money is integer kobo; percentages are integer basis points. No floats. Arithmetic and formatting only in `src/lib/money.ts`.
- `Setting.value` is a string holding integer basis points ("300", "500", "2000"); it is parsed to an integer in exactly one place, `parseBps` in `src/lib/money.ts`.
- Defaults: AgroHub fee 300 bps (3%), maximum cooperative cut 500 bps (5%), price-deviation threshold 2000 bps (20%).
- Each cooperative sets its cut up to the admin maximum. The AgroHub fee and the cooperative cut come out of the sale price, not on top.
- Before submitting, the farmer sees the cooperative cut, the AgroHub fee and the take-home per unit.
- The price warning is neutral (`OK | HIGH | LOW`, no judgement words); the farmer may proceed with a note.
- Officers cannot approve their own lots; another officer does, or an admin when there is none.
- Only approved lots are visible to buyers, at the asking price. The floor is never shown to buyers, including in rejections. Private fields leave the server only through `catalog/views.ts` mappers.
- On approval the fee terms are locked to that lot; later changes to the cut or fee apply only to new lots.
- A suspended cooperative's lots are hidden. A farmer without a payout account cannot list (spec 13, Option A).
- Lots carry an available-until date and hide themselves after it passes. Officers set a minimum order quantity per lot.
- Every scheduled job is safe to run twice (`runOnce`); Vercel Hobby allows at most daily crons.
- Approvals, price changes and setting changes write to the append-only audit log. Audit `meta` holds ids, kobo amounts, bps and statuses only, and never the floor.
- All user-facing strings in `messages/*.json`, keys mirrored in all five files. Never call the held payment "escrow".
- Business logic only in `src/modules/*/service.ts`; every service function takes an `Actor` and calls `can()` first (public reads carry a comment saying why they have none).
- Migrations are created with `npx prisma migrate dev --create-only` and reviewed; run `npx prisma generate` afterwards.
- Before each commit: `npm run lint`, `npm run typecheck`, `npm test`. No Co-Authored-By or "Generated with" lines. Stage files explicitly.

## Review Focus

1. An officer who is also a farmer in the same cooperative approves their own lot, including in a one-person cooperative: refused; an admin can approve only when no other active officer exists, and never their own lot (Task 7, `officer_cannot_approve_own_lot`, `admin_approves_when_no_other_officer`, `admin_cannot_approve_when_other_officer_exists`).
2. The floor reaches a public output: the public lot list's JSON, the `/lots` page text, a counter or rejection shown to anyone, or an audit row (Task 5, `public_lot_type_has_no_floor`; Task 7, `audit_meta_never_contains_floor`; Task 10, `public_lots_never_contain_floor`; Task 11 e2e asserts the floor amount is absent from `/lots`).
3. The admin changes the fee or maximum cut, or the officer changes the cut, between the farmer's submission and the officer's approval: the lot locks the terms the farmer was shown, and only new lots get the new terms (Task 7, `terms_locked_at_quote_survive_setting_change`).
4. Two officers act on the same pending lot at once (one approves, one rejects), or a farmer withdraws while an officer approves: exactly one change wins, the other gets `LOT_NOT_PENDING` (Task 7, `concurrent_screening_has_one_winner`).
5. A cooperative is suspended, or a lot's available-until date passes before the daily job runs: its lots vanish from the public list at once (Task 10, `suspended_cooperative_lots_are_hidden`, `lot_past_available_until_is_hidden_before_job_runs`).

## Decisions this plan makes

Decided by the user (2026-11-03):
- **The AgroHub fee and the maximum cooperative cut live in a new `Setting` table** `{ key, value }` (architecture section 5). The value is a string holding integer basis points, parsed to an integer in exactly one place (`parseBps`), never a float. Defaults: fee "300", maximum cut "500". The spec's open item and architecture section 11 are updated to say so.
- **The price-deviation threshold moves into `Setting`** (key `price_deviation_bps`, default "2000"); `DEFAULT_DEVIATION_THRESHOLD_BPS` becomes the code default behind it.
- **`demo-screens` is retired**: nothing here builds on it.
- **A farmer whose crop is not on the board's list asks for it**: the request goes to their cooperative's officers, who forward it (or decline it, or point to a crop already listed), and then it is approved and the crop added (Task 4).

Made by this plan for crop requests:
- **The same request flow covers units** (a missing "mudu" blocks a lot just as a missing crop does).
- **Board admins, not general admins, approve requests**, since the spec makes the crop and unit list a board-admin job; approving one request approves every open request for the same name from any cooperative. Requests are deduplicated per cooperative, and a farmer has at most 5 open at once.
- **The outcome shows on the farmer's page**, not by email (email is blocked).

Made by this plan (the spec is silent; each is flagged in the PR):
- **Settings defaults live in code, not in a data migration.** A missing row means the default; an admin edit upserts the row. A stored value that fails `parseBps` throws, so a corrupt setting fails loudly instead of quoting wrong terms. Bounds: fee and maximum cut each 0 to 5000 bps; deviation threshold 100 to 10000 bps.
- **A cooperative's cut defaults to 0** (`Cooperative.cutBps`). If the admin lowers the maximum below a cooperative's cut, new quotes use the lower of the two (`effectiveCutBps`); the officer's screen says so.
- **Terms are quoted at submission and locked at approval.** The lot stores the cut and fee the farmer was shown (`quotedCutBps`, `quotedFeeBps`); approval copies exactly those into `LotFeeTerms`. This keeps spec 6.3 ("locked on approval") and the anti-goal "terms changing after a farmer has agreed to them". A revision keeps the lot's locked terms.
- **One farmer per lot.** A farmer submits a lot, and `LotContribution` holds one row (that farmer, the full quantity), ready for Phase 5's payout apportioning. Officers combining several farmers into one lot is left for later.
- **No server-side DRAFT status.** Spec 9's "drafts kept if the connection drops" is met by saving the unsent form in `localStorage` (photos excepted). The `LotStatus` enum is `PENDING_REVIEW, COUNTERED, REJECTED, LIVE, WITHDRAWN, EXPIRED, SOLD_OUT` (`SOLD_OUT` unused until Phase 5).
- **Quantity is a whole number of units** (1 to 1,000,000); grade is one of `A`, `B`, `C`, `UNGRADED`; the pickup place is a state and LGA (defaulting to the farmer's profile) plus an optional 120-character pickup note. These suit Phase 4's filters.
- **The floor is required, positive and at most the asking price.** A counter below the floor is refused (`COUNTER_BELOW_FLOOR`); the officer rejects with a reason instead.
- **A counter is a new asking price plus an optional message.** Accepting it makes the lot live at that price with the quoted terms locked (the countering officer is the approver); declining it withdraws the lot (the farmer can submit again).
- **The board warning compares against every market's latest price** for that crop and unit within the board's window (no averaging, so no division): `HIGH` if the ask is high against all of them, `LOW` if low against all, otherwise `OK`; no board price means no warning. The result is stored on the lot (`deviation`) for the officer. When it is `HIGH` or `LOW` the note is required (`NOTE_REQUIRED`, at least 10 characters).
- **Photos:** 1 to 4 per lot, JPEG or WebP, at most 1 MB each after compression, contents checked against the declared type. The browser scales each photo so its long edge is at most 1600 px and re-encodes it as JPEG at quality 0.8 with `<canvas>` (no dependency). Photos are stored with `putPrivate` and shown through `signedUrl` links (1 hour).
- **Available-until** is a Lagos calendar date from today to 90 days ahead. A lot is hidden once that date is before today in Lagos; the daily `lot-expiry` job (04:00 UTC) marks such lots `EXPIRED`.
- **Minimum order quantity** is set by the officer on approval (default 1, at most the quantity).
- **Edits:** a change to a live lot's asking price, quantity or floor creates one pending `LotRevision` (a newer request replaces an older pending one); the live version stays until an officer approves it under the same self-approval rule. Withdrawal is allowed from `PENDING_REVIEW`, `COUNTERED` or `LIVE` when `hasOpenOrders(lotId)` is false (a stub returning false until Phase 5, like `farmers/orders-guard.ts`).
- **Farmer profile crops move to the board's crop list** (an implicit many-to-many `FarmerProfile.crops Crop[]`). The migration links existing free-text crops whose normalized name matches a crop's `nameKey`, and drops the text column; unmatched text is lost (staging holds only seed users). Choosing crops is optional on joining, so joining never blocks while the list is empty; a farmer edits their crops on `/farmer`.
- **A minimal public list at `/lots`** shows live lots (no filters, no detail page: Phase 4 builds those) so "goes live" is visible and the no-floor rule is tested on a real page. Public lots show the cooperative's name, never the farmer's.
- **No lot emails in this phase.** Email is blocked everywhere, and spec 6.11's event emails are Phase 8.

---

### Task 1: Platform settings

**Files:**
- Modify: `prisma/schema.prisma` (model `Setting`), `src/lib/money.ts`, `src/modules/board/deviation.ts` (comment: default now sits behind `Setting`), `src/modules/identity/policies.ts`, `tests/access/policy-matrix.test.ts`, `src/components/nav-links.ts`, `messages/*.json`
- Create: migration `settings`, `src/modules/settings/service.ts`, `src/modules/settings/schema.ts`, `src/app/admin/settings/page.tsx`, `src/app/admin/settings/settings-form.tsx`, action in `src/app/admin/actions.ts`
- Test: `tests/unit/money.test.ts`, `tests/integration/settings.test.ts`, `tests/unit/header-nav.test.ts` (or wherever `navLinksFor` is tested)

**Interfaces:**
- Produces:
  - `model Setting { key String @id; value String; updatedByUserId String?; updatedAt DateTime @updatedAt }` (`@@map("setting")`).
  - `parseBps(value: string): number` in `money.ts`: accepts `/^\d{1,5}$/` up to 10000, else `RangeError`.
  - `SETTING_KEYS = { platformFeeBps: "platform_fee_bps", maxCooperativeCutBps: "max_cooperative_cut_bps", priceDeviationBps: "price_deviation_bps" }`; `DEFAULT_SETTINGS: PlatformSettings = { platformFeeBps: 300, maxCooperativeCutBps: 500, priceDeviationBps: 2000 }`.
  - `getPlatformSettings(): Promise<PlatformSettings>`: no Actor (the values are public terms shown to every farmer); missing rows fall back to the defaults; values go through `parseBps`.
  - `updatePlatformSettings(actor, input: { platformFeeBps: number; maxCooperativeCutBps: number; priceDeviationBps: number }): Promise<PlatformSettings>`: `can(actor, "setting:write")`; zod bounds from the Decisions (`ValidationError` `INVALID_SETTING`); upserts changed rows and writes one `setting.update` audit row per changed key `{ key, fromBps, toBps }`, in one transaction.
  - Action `"setting:write"`: `actor.role === "ADMIN"`.
  - `/admin/settings`: three percentage fields entered as percent with up to two decimals ("3", "2.5") and converted with a `percentToBps(value: string): number` helper in `money.ts` (`SyntaxError` → `INVALID_SETTING`); ADMIN nav gains `{ href: "/admin/settings", labelKey: "platformSettings" }`.

- [ ] **Step 1: Write the failing tests.** `money.test.ts`: `parseBps("300")` → 300; `parseBps("10000")` → 10000; `"10001"`, `"3.5"`, `""`, `"-1"`, `" 300"` throw `RangeError`; `percentToBps("3")` → 300, `("2.5")` → 250, `("0.01")` → 1, `("2.555")` throws `SyntaxError`. `settings.test.ts`: `getPlatformSettings()` on an empty table equals the defaults; `updatePlatformSettings` by an admin changes the fee to 250, `getPlatformSettings().platformFeeBps` is 250, one `setting.update` row has `{ fromBps: 300, toBps: 250 }`, and unchanged keys write no row; a BOARD_ADMIN actor → `ForbiddenError`; `platformFeeBps: 5001` → `INVALID_SETTING`; a row stored as `"3%"` makes `getPlatformSettings()` throw. Matrix: five rows for `setting:write` (only ADMIN). Nav: `navLinksFor("ADMIN")` includes `/admin/settings`.
- [ ] **Step 2: Run** `npm test -- tests/unit/money.test.ts tests/integration/settings.test.ts tests/access/policy-matrix.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** model, migration (`--create-only --name settings`), `parseBps`/`percentToBps`, service, policy, page, action and messages. Add `setting` to `cleanDatabase`.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: platform settings for AgroHub fee, maximum cut and deviation threshold` (body: defaults in code; values are bps strings parsed only by parseBps).

### Task 2: Cooperative cut

**Files:**
- Modify: `prisma/schema.prisma` (`Cooperative.cutBps Int @default(0)`), `src/modules/cooperatives/service.ts`, `src/modules/cooperatives/views.ts`, `src/app/officer/actions.ts`, `src/app/officer/onboarding/page.tsx`, `messages/*.json`
- Create: migration `cooperative_cut`, `src/app/officer/onboarding/cut-form.tsx`
- Test: `tests/integration/cooperative-cut.test.ts`

**Interfaces:**
- Consumes: `getPlatformSettings` (Task 1).
- Produces:
  - `setCooperativeCut(actor, cooperativeId: string, cutBps: number): Promise<{ cutBps: number }>`: `can(actor, "cooperative:edit", { cooperativeId })`; integer 0 to the current maximum, else `ValidationError` `CUT_ABOVE_MAXIMUM` / `INVALID_CUT`; any cooperative status; audit `cooperative.cut` `{ cooperativeId, fromBps, toBps }` when it changes.
  - `effectiveCutBps(cooperativeCutBps: number, maxCooperativeCutBps: number): number` (the lower of the two) in `money.ts`.
  - `OfficerCooperative` gains `cutBps`. The officer's cooperative page shows the cut as a percentage, the current maximum, and the "your cut is above the new maximum; new lots use X%" notice when relevant.

- [ ] **Step 1: Write the failing tests.** An officer sets 400 → stored 400, one `cooperative.cut` row; 501 with the default maximum → `CUT_ABOVE_MAXIMUM`; 1.5 → `INVALID_CUT`; an officer of another cooperative → `ForbiddenError`; after the admin lowers the maximum to 300, `effectiveCutBps(400, 300)` is 300 (unit row in `money.test.ts`).
- [ ] **Step 2: Run** `npm test -- tests/integration/cooperative-cut.test.ts tests/unit/money.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** field, migration (`--name cooperative_cut`), service, view, form and action (percent input via `percentToBps`).
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: each cooperative sets its cut up to the admin maximum`.

### Task 3: Farmer crops from the board's crop list

**Files:**
- Modify: `prisma/schema.prisma` (`FarmerProfile.crops Crop[]`, `Crop.farmers FarmerProfile[]`), `src/modules/farmers/schema.ts`, `src/modules/farmers/service.ts`, `src/modules/farmers/views.ts`, `src/app/join/[token]/page.tsx`, `src/app/join/[token]/profile-form.tsx`, `src/app/farmer/page.tsx`, `src/app/farmer/actions.ts`, `prisma/seed.ts`, `messages/*.json`, existing tests that pass `crops: string[]` (`farmer-join.test.ts`, `farmer-approval.test.ts`, `farmer-views.test.ts`, e2e `cooperative-to-farmer.spec.ts`)
- Create: migration `farmer_crop_list` (hand-edited: create the join table, insert links where `lower(trim(text)) = crop."nameKey"`, then drop the text column)
- Test: `tests/integration/farmer-crops.test.ts`

**Interfaces:**
- Consumes: `listActiveCatalog` (Phase 2).
- Produces:
  - `farmerProfileInput.cropIds: z.array(z.string().min(1)).max(20)` (may be empty); `FarmerProfileInput.cropIds: string[]`; `splitCrops` is removed.
  - Unknown or inactive crop id → `ValidationError` `CROP_INACTIVE`.
  - `OwnFarmer.crops: { id: string; name: string }[]` (and the officer and admin views likewise).
  - New action `"farmer:profile"`: FARMER and `ownerUserId === actor.userId`.
  - `updateOwnCrops(actor, cropIds: string[]): Promise<OwnFarmer>`: `can(actor, "farmer:profile", { ownerUserId: actor.userId })`; edits only the caller's own profile.
  - The join form and `/farmer` show active crops as checkboxes (44 px rows), with an empty-list message when the board has none.

- [ ] **Step 1: Write the failing tests.** `farmer-crops.test.ts`: joining with two active crop ids links both and `toOwnFarmer` lists their names; joining with no crops succeeds; a deactivated crop id → `CROP_INACTIVE`; `updateOwnCrops` replaces the set; an OFFICER actor → `ForbiddenError`. Matrix rows for `farmer:profile`. The back-fill SQL is checked by hand on a scratch database (a profile with text `{" maize "}` and a crop "Maize" ends up linked), and the commit body says so.
- [ ] **Step 2: Run** `npm test -- tests/integration/farmer-crops.test.ts tests/access/policy-matrix.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema change, migration (`--create-only --name farmer_crop_list`, then add the back-fill `INSERT ... SELECT` before the `DROP COLUMN`), schema, service, views, forms and seed; update the existing tests to `cropIds`.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: farmer crops come from the board's crop list` (body: matched free text back-filled, the rest dropped; crops optional on joining).

### Task 4: Requests for a missing crop or unit

**Files:**
- Modify: `prisma/schema.prisma` (model `CatalogRequest`), `src/modules/catalog/service.ts` (re-exports), `src/modules/catalog/views.ts`, `src/modules/identity/policies.ts`, `tests/access/policy-matrix.test.ts`, `tests/integration/helpers.ts`, `src/app/farmer/page.tsx`, `src/app/farmer/actions.ts`, `src/app/officer/farmers/page.tsx`, `src/app/officer/actions.ts`, `src/app/board/crops/page.tsx`, `src/app/board/actions.ts`, `messages/*.json`
- Create: migration `catalog_requests`, `src/modules/catalog/requests.ts`, `src/app/farmer/crop-requests.tsx`, `src/app/officer/farmers/catalog-requests-panel.tsx`, `src/app/board/crops/requests-panel.tsx`
- Test: `tests/integration/catalog-requests.test.ts`

**Interfaces:**
- Consumes: `createCrop`, `createUnit`, `setCropActive`, `setUnitActive`, `normalizeName`, `nameKeyOf` (Phase 2).
- Produces:
  - Enums `CatalogKind { CROP UNIT }`, `CatalogRequestStatus { WITH_OFFICER FORWARDED DECLINED APPROVED }`.
  - `model CatalogRequest { id, kind CatalogKind, name, nameKey, cooperativeId, requestedByUserId, status CatalogRequestStatus @default(WITH_OFFICER), declineReason String?, declinedBy String? ("OFFICER" | "BOARD_ADMIN"), resolvedItemId String?, forwardedByUserId String?, decidedByUserId String?, createdAt, updatedAt; @@index([cooperativeId, status]); @@index([status, kind, nameKey]) }` (`@@map("catalog_request")`). `resolvedItemId` is a crop or unit id, so it has no foreign key.
  - Actions: `"catalog:request"`: FARMER with own cooperative; `"catalog:forward"`: OFFICER with own cooperative. Board-admin decisions use the existing `"catalog:manage"`.
  - `requestCatalogItem(actor, input: { kind: "CROP" | "UNIT"; name: string }): Promise<CatalogRequestView>`: name through `nameInput`; an ACTIVE crop or unit with that `nameKey` → `ConflictError` `CROP_EXISTS` / `UNIT_EXISTS` (the farmer just picks it); an open request (WITH_OFFICER or FORWARDED) of the same kind and `nameKey` from the same cooperative → returns that request, no new row; a farmer with 5 open requests → `ValidationError` `REQUEST_LIMIT`; audit `catalog_request.create`.
  - `listOwnCatalogRequests(actor): Promise<CatalogRequestView[]>` (newest first).
  - Officer, all scoped to `actor.cooperativeId` (another cooperative's request → `NotFoundError` `REQUEST_NOT_FOUND`), each a conditional `updateMany` on `status: "WITH_OFFICER"` (`REQUEST_NOT_OPEN`): `listCooperativeCatalogRequests(actor)` (WITH_OFFICER, oldest first, with the farmer's name); `forwardCatalogRequest(actor, id)` → FORWARDED; `declineCatalogRequestAsOfficer(actor, id, { reason })` → DECLINED (reason 3 to 300 characters, `REASON_REQUIRED`); `matchCatalogRequest(actor, id, itemId)` → APPROVED with `resolvedItemId` (the item must be an active crop or unit of the same kind, `ITEM_NOT_FOUND`), for "that's already listed as Sorghum".
  - Board admin (`catalog:manage`): `listForwardedCatalogRequests(actor)` (FORWARDED, grouped by kind and `nameKey`, each group with the cooperatives asking and its oldest date); `approveCatalogRequest(actor, id, input: { name?: string })`: the board admin may correct the spelling; if a crop or unit with that `nameKey` exists it is reactivated when inactive, otherwise it is created through `createCrop`/`createUnit`; then every open request of that kind and `nameKey` (any cooperative) becomes APPROVED with that `resolvedItemId`, in one transaction with audit `catalog_request.approve` per request; `declineCatalogRequest(actor, id, { reason })` → DECLINED for that one request.
  - `CatalogRequestView = { id; kind; name; status; declineReason: string | null; resolvedItemName: string | null; createdAt: string }` via `toCatalogRequestView`; the officer view adds `farmerName`, the board-admin view adds `cooperativeNames: string[]`. No phone or email in any of them.
  - Screens: on `/farmer` a "My crop or unit isn't listed" section (anchor `#crop-requests`) with kind, name, and the farmer's requests and their status in plain words ("With your officer", "Sent to the price board team", "Added: you can now choose Tiger nut", "Not added: <reason>"); on `/officer/farmers` a "Crop and unit requests" panel with Forward, Decline (reason) and "Already listed as…" (a select of active items of that kind); on `/board/crops` a "Requests from cooperatives" panel with Approve (name prefilled, editable) and Decline (reason).

- [ ] **Step 1: Write the failing tests** in `catalog-requests.test.ts`:
  - a farmer requests crop "Tiger nut" → WITH_OFFICER, one audit row; requesting " tiger  NUT " again returns the same request id; a second farmer in the same cooperative asking for it also gets that request; a farmer in another cooperative gets a new one;
  - requesting "Maize" when Maize is active → `CROP_EXISTS`; when Maize is deactivated → a request is created;
  - a sixth open request from one farmer → `REQUEST_LIMIT`;
  - the officer forwards → FORWARDED; forwarding again → `REQUEST_NOT_OPEN`; an officer of another cooperative → `REQUEST_NOT_FOUND`; the officer declines another with a reason → DECLINED and the farmer's view shows the reason;
  - `matchCatalogRequest` to the active crop Sorghum → APPROVED, `resolvedItemName` "Sorghum"; matching to a unit id → `ITEM_NOT_FOUND`;
  - the board admin approves "Tiger nut" requests forwarded from two cooperatives (approving one approves both), with the name corrected to "Tiger Nut" → one active crop "Tiger Nut" in `listActiveCatalog()`, both requests APPROVED, and the first farmer can now save it with `updateOwnCrops`;
  - approving a request whose name matches a deactivated crop reactivates that crop rather than creating a second;
  - an ADMIN (not board admin) approving → `ForbiddenError`; a BOARD_ADMIN cannot forward (`ForbiddenError`).
  - Matrix rows for `catalog:request` and `catalog:forward`.
- [ ] **Step 2: Run** `npm test -- tests/integration/catalog-requests.test.ts tests/access/policy-matrix.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the model, migration (`--create-only --name catalog_requests`), service, views, actions and the three panels. Add `catalogRequest` to `cleanDatabase`.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: farmers ask for a missing crop or unit; officers forward, board admins add it`.

### Task 5: Lot submission

**Files:**
- Modify: `prisma/schema.prisma`, `src/modules/catalog/service.ts` (re-exports), `src/modules/catalog/views.ts`, `src/modules/board/service.ts`, `src/modules/board/deviation.ts`, `src/modules/identity/policies.ts`, `tests/access/policy-matrix.test.ts`, `tests/integration/helpers.ts`
- Create: migration `lots`, `src/modules/catalog/lots.ts`, `src/modules/catalog/lot-schema.ts`, `src/modules/catalog/photos.ts`, `src/modules/catalog/orders-guard.ts`, `src/lib/lagos-date.ts`
- Test: `tests/integration/lots.test.ts`, `tests/unit/deviation.test.ts`, `tests/unit/lot-views.test.ts`, `tests/unit/lagos-date.test.ts`, `tests/unit/lot-photos.test.ts`

**Interfaces:**
- Consumes: `getPlatformSettings`, `effectiveCutBps`, `saleBreakdown`, `putPrivate`, `priceDeviation`.
- Produces:
  - Enums `LotStatus { PENDING_REVIEW COUNTERED REJECTED LIVE WITHDRAWN EXPIRED SOLD_OUT }`, `LotGrade { A B C UNGRADED }`, `Deviation { OK HIGH LOW }`.
  - `model Lot { id, cooperativeId, farmerUserId, cropId, unitId, quantity Int, grade LotGrade, pickupState, pickupLga, pickupNote String?, askKobo Int, floorKobo Int, note String?, deviation Deviation?, quotedCutBps Int, quotedFeeBps Int, status LotStatus @default(PENDING_REVIEW), availableUntil DateTime @db.Date, minOrderQty Int @default(1), counterAskKobo Int?, counterMessage String?, rejectionReason String?, screenedByUserId String?, approvedAt DateTime?, createdAt, updatedAt; @@index([cooperativeId, status]); @@index([status, availableUntil]) }` (`@@map("lot")`); `farmerUserId` is a relation to `User` with `onDelete: Restrict`.
  - `model LotContribution { id, lotId, farmerUserId, quantity Int; @@unique([lotId, farmerUserId]) }`, `model LotPhoto { id, lotId, storageKey, contentType, sizeBytes Int, position Int; @@unique([lotId, position]) }`, `model LotFeeTerms { id, lotId @unique, cooperativeCutBps Int, platformFeeBps Int, lockedAt DateTime }` (created in Task 7, defined here).
  - `lagosDateKey(at: Date): string` (`YYYY-MM-DD` in UTC+1) and `lagosDate(key: string): Date` (that date at 00:00 UTC, for `@db.Date` columns).
  - `boardReference(cropId: string, unitId: string, now?: Date): Promise<BoardPrice[]>` in `board/service.ts`: latest price per market for that active crop and unit within the board window; `BoardPrice = { market: string; weekOf: string; priceKobo: number }`. Public read, no Actor (comment).
  - `askDeviation(askKobo: number, prices: number[], thresholdBps: number): Deviation | null` in `deviation.ts`: `null` for no prices; `HIGH`/`LOW` only when every price gives that result; else `OK`.
  - Actions: `"lot:submit"`: FARMER and own cooperative; `"lot:own"`: FARMER, own cooperative and `ownerUserId === actor.userId`.
  - `submitLotInput` zod (`lot-schema.ts`): `cropId`, `unitId`, `quantity` (int 1 to 1,000,000), `grade`, `pickupState` (one of `STATES`), `pickupLga` (1 to 80), `pickupNote?` (≤ 120), `askKobo` (int 1 to 2,000,000,000), `floorKobo` (int ≥ 1 and ≤ `askKobo`, else `FLOOR_ABOVE_ASK`), `note?` (≤ 500), `availableUntil` (`YYYY-MM-DD`).
  - `validatePhoto(photo: { body: Buffer; contentType: string }): void` in `photos.ts`: `image/jpeg` (`FF D8 FF`) or `image/webp` (`RIFF....WEBP`) only (`PHOTO_TYPE_NOT_ALLOWED`, `PHOTO_TYPE_MISMATCH`), at most 1,048,576 bytes (`PHOTO_TOO_LARGE`).
  - `submitLot(actor, input: SubmitLotInput, photos: { body: Buffer; contentType: string }[], now = new Date()): Promise<FarmerLot>`: `can(actor, "lot:submit", { cooperativeId: actor.cooperativeId })`; cooperative VERIFIED (`COOPERATIVE_NOT_VERIFIED`); farmer profile has a `recipientCode` (`BANK_ACCOUNT_REQUIRED`); active crop and unit (`CROP_INACTIVE`, `UNIT_INACTIVE`); `availableUntil` from today to today + 90 in Lagos (`INVALID_AVAILABLE_UNTIL`); 1 to 4 photos (`PHOTO_COUNT`), each validated; `deviation = askDeviation(ask, boardReference prices, settings.priceDeviationBps)`; `HIGH`/`LOW` with a note under 10 characters → `NOTE_REQUIRED`; `quotedCutBps = effectiveCutBps(coop.cutBps, settings.maxCooperativeCutBps)`, `quotedFeeBps = settings.platformFeeBps`. Photos are stored at `lots/<lotId>/<random hex>` before the transaction that creates the lot, its contribution row (full quantity) and photo rows, and the audit row `lot.submit` `{ lotId, cooperativeId, askKobo, quantity, deviation }`.
  - `hasOpenOrders(lotId: string): Promise<boolean>` in `orders-guard.ts`, returning false (comment: Phase 5).
  - Views: `FarmerLot` (owner: everything including `floorKobo`, `quoted` terms, `lockedTerms | null`, `counterAskKobo`, `counterMessage`, `rejectionReason`, `pendingRevision | null`, `photoKeys` resolved to URLs by the service), `OfficerLot` (`FarmerLot` plus `farmerName`; no phone, no bank data), `PublicLot = { id; cooperativeName; crop; unit; quantity; grade; pickupState; pickupLga; askKobo; minOrderQty; availableUntil; photoUrls: string[] }` via `toPublicLot`.

- [ ] **Step 1: Write the failing tests.**
  - `lagos-date.test.ts`: `lagosDateKey(new Date("2026-11-03T23:30:00Z"))` → `"2026-11-04"`; `("2026-11-03T22:59:00Z")` → `"2026-11-03"`.
  - `deviation.test.ts` (add): `askDeviation(130000, [100000, 105000], 2000)` → `HIGH`; `(130000, [100000, 120000], 2000)` → `OK`; `(70000, [100000, 95000], 2000)` → `LOW`; `(50000, [], 2000)` → `null`.
  - `lot-photos.test.ts`: a JPEG header buffer passes; a PNG buffer declared `image/jpeg` → `PHOTO_TYPE_MISMATCH`; `image/png` → `PHOTO_TYPE_NOT_ALLOWED`; 1,048,577 bytes → `PHOTO_TOO_LARGE`.
  - `lot-views.test.ts`: `public_lot_type_has_no_floor`: `JSON.stringify(toPublicLot(lotWithFloor 4321987))` does not contain `"4321987"`, `"floor"` or the farmer's user id; plus a type-level check `// @ts-expect-error` on `publicLot.floorKobo`.
  - `lots.test.ts`: a farmer in a VERIFIED cooperative with a bank account submits a lot → status `PENDING_REVIEW`, one contribution for the full quantity, one photo in fake storage, `quotedCutBps` = the cooperative's cut and `quotedFeeBps` = 300, one `lot.submit` audit row whose meta has no `floorKobo`; `floorKobo > askKobo` → `FLOOR_ABOVE_ASK`; cooperative PENDING → `COOPERATIVE_NOT_VERIFIED`; no recipient code → `BANK_ACCOUNT_REQUIRED`; zero photos and five photos → `PHOTO_COUNT`; `availableUntil` yesterday and 91 days ahead → `INVALID_AVAILABLE_UNTIL`; board price 100000 at one market, ask 130000 and no note → `NOTE_REQUIRED`, with a 10-character note → stored `deviation: "HIGH"`; no board price → `deviation: null`; an OFFICER actor → `ForbiddenError`.
  - Matrix rows for `lot:submit` and `lot:own`.
- [ ] **Step 2: Run** `npm test -- tests/unit/lagos-date.test.ts tests/unit/deviation.test.ts tests/unit/lot-photos.test.ts tests/unit/lot-views.test.ts tests/integration/lots.test.ts tests/access/policy-matrix.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the models, migration (`--create-only --name lots`), helpers, views and `submitLot`. Add `lotFeeTerms`, `lotPhoto`, `lotContribution`, `lot` to `cleanDatabase` before `farmerProfile`; clear `fakeStorage` there too if it is not already.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: farmers submit harvest lots with a private floor, photos and a board check` (body: quoted terms stored at submission; warning against every market; note required when it shows).

### Task 6: Farmer lot screens

**Files:**
- Create: `src/app/farmer/lots/page.tsx` (my lots and their status), `src/app/farmer/lots/new/page.tsx`, `src/app/farmer/lots/new/lot-form.tsx`, `src/app/farmer/lots/[id]/page.tsx`, `src/app/farmer/lots/actions.ts`, `src/lib/image-compress.ts`
- Modify: `src/modules/catalog/lots.ts` (`listOwnLots`, `getOwnLot`), `src/components/nav-links.ts`, `next.config.ts` (comment on the body size limit now also covering 4 MB of photos), `messages/*.json`
- Test: `tests/unit/image-compress.test.ts`, `tests/integration/lots.test.ts` (new cases), nav test

**Interfaces:**
- Consumes: Task 5 `submitLot`, `FarmerLot`; `boardReference`; `getPlatformSettings`; `saleBreakdown`, `askDeviation`, `toKobo`, `formatNaira`.
- Produces:
  - `listOwnLots(actor): Promise<FarmerLot[]>` (newest first) and `getOwnLot(actor, lotId): Promise<FarmerLot>` (`can(actor, "lot:own", ...)`; another farmer's lot → `NotFoundError` `LOT_NOT_FOUND`, never Forbidden, so ids cannot be probed).
  - `fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number }` (integers, aspect kept, never upscales) and `compressImage(file: File, maxEdge = 1600, quality = 0.8): Promise<Blob>` (browser only, `createImageBitmap` + `<canvas>.toBlob("image/jpeg")`) in `image-compress.ts`.
  - `submitLotAction(form: FormData): Promise<ActionResult<{ lotId: string }>>`: naira fields through `toKobo` (`SyntaxError` → `INVALID_PRICE`), photos read from `form.getAll("photos")`.
  - The form: crop and unit selects (active only), quantity, grade, pickup state/LGA prefilled from the profile, ask and floor in naira, available-until date, note, photos (`accept="image/jpeg,image/webp,image/*"`, compressed before upload, thumbnails shown). Below the price, a live breakdown from `saleBreakdown(ask, quantity, quotedCut, fee)`: "Cooperative cut", "AgroHub fee", "You take home per unit", "You take home in total", and the neutral warning when `askDeviation` is `HIGH`/`LOW` ("Your price is above / below the board prices for this crop at: Bodija ₦50,000.00 (week of 26 Oct 2026) … You can still submit; add a note for your officer."), with the note field marked required. The page passes `boardPrices: Record<"cropId:unitId", BoardPrice[]>`, `quotedCutBps`, `platformFeeBps`, `priceDeviationBps` to the client form. The unsent fields (not photos) are kept in `localStorage` under `agrohub:lot-draft` and cleared after a successful submit.
  - Under the crop and unit selects, a "My crop or unit isn't listed" link to `/farmer#crop-requests` (Task 4); the unsent lot draft survives the trip.
  - Farmer nav gains `{ href: "/farmer/lots", labelKey: "myLots" }`. A farmer without a bank account or in an unverified cooperative sees why they cannot list instead of the form.

- [ ] **Step 1: Write the failing tests.** `image-compress.test.ts`: `fitWithin(4000, 3000, 1600)` → `{ 1600, 1200 }`; `(1200, 1600, 1600)` → unchanged; `(3000, 4000, 1600)` → `{ 1200, 1600 }`; `(801, 3, 400)` → width 400, height at least 1. `lots.test.ts`: `listOwnLots` returns only the caller's lots; `getOwnLot` for another farmer's lot → `LOT_NOT_FOUND`. Nav: `navLinksFor("FARMER")` hrefs equal `["/farmer", "/farmer/lots", "/prices"]`.
- [ ] **Step 2: Run** `npm test -- tests/unit/image-compress.test.ts tests/integration/lots.test.ts tests/unit/header-nav.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the reads, compression helper, action, pages and form with the kit (phone-first, inputs at least 44 px, labels from messages).
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: farmer lot form with live take-home, board warning and compressed photos`.

### Task 7: Screening, self-approval rule and locked terms

**Files:**
- Modify: `src/modules/catalog/lots.ts`, `src/modules/catalog/service.ts`, `src/modules/identity/policies.ts` (new `"lot:screen"`), `tests/access/policy-matrix.test.ts`
- Test: `tests/integration/lot-screening.test.ts`

**Interfaces:**
- Consumes: Task 5 models and views; existing `"lot:approve"` rule (`cooperativeHasOtherOfficer`, `ownerUserId`).
- Produces:
  - `"lot:screen"` (may see a screening queue): OFFICER with own cooperative, or ADMIN.
  - `otherOfficerExists(cooperativeId: string, ownerUserId: string): Promise<boolean>`: an ACTIVE OFFICER membership in that cooperative for a different user.
  - `approveLot(actor, lotId, input: { minOrderQty: number }, now = new Date()): Promise<OfficerLot>`: loads the lot, then `can(actor, "lot:approve", { cooperativeId, ownerUserId: lot.farmerUserId, cooperativeHasOtherOfficer })` (`ForbiddenError` `CANNOT_APPROVE_OWN_LOT` when the owner is the actor, else `ForbiddenError`); `minOrderQty` int 1 to quantity (`INVALID_MIN_ORDER`); in one transaction: `updateMany where { id, status: "PENDING_REVIEW" }` → `LIVE` with `approvedAt`, `screenedByUserId`, `minOrderQty` (count 0 → `ConflictError` `LOT_NOT_PENDING`), create `LotFeeTerms` from `quotedCutBps`/`quotedFeeBps`, audit `lot.approve` `{ lotId, cooperativeCutBps, platformFeeBps, minOrderQty }`.
  - `rejectLot(actor, lotId, input: { reason: string })`: same permission; reason 3 to 500 characters (`REASON_REQUIRED`); `PENDING_REVIEW` → `REJECTED`; audit `lot.reject` `{ lotId }` (the reason is not copied into the audit meta).
  - `counterLot(actor, lotId, input: { counterAskKobo: number; message?: string })`: same permission; `counterAskKobo` ≥ `floorKobo` (`COUNTER_BELOW_FLOOR`) and ≠ `askKobo` (`COUNTER_SAME_AS_ASK`); `PENDING_REVIEW` → `COUNTERED`; audit `lot.counter` `{ lotId, fromKobo, toKobo }`.
  - `respondToCounter(actor, lotId, accept: boolean, now = new Date())`: `can(actor, "lot:own", ...)`; `COUNTERED` only (`LOT_NOT_COUNTERED`); accept → `askKobo = counterAskKobo`, `LIVE`, `approvedAt`, `LotFeeTerms` from the quoted terms, audit `lot.counter_accept`; decline → `WITHDRAWN`, audit `lot.counter_decline`. Both clear `counterAskKobo`/`counterMessage`.
  - `listScreeningQueue(actor): Promise<OfficerLot[]>`: `can(actor, "lot:screen")`; an officer sees their cooperative's `PENDING_REVIEW` and `COUNTERED` lots (own lots included, flagged `canApprove: false`); an admin sees only `PENDING_REVIEW` lots whose cooperative has no other active officer than the lot's owner. `getLotForScreening(actor, lotId): Promise<OfficerLot & { canApprove: boolean; boardPrices: BoardPrice[] }>`.

- [ ] **Step 1: Write the failing tests.**
  - `officer_cannot_approve_own_lot`: a user holding FARMER and OFFICER memberships in one cooperative submits as farmer; as officer, `approveLot`, `rejectLot` and `counterLot` → `CANNOT_APPROVE_OWN_LOT`; a second officer of that cooperative approves → `LIVE`.
  - `admin_approves_when_no_other_officer`: the same user is the cooperative's only officer → an ADMIN actor approves; the lot appears in the admin's queue and not after approval.
  - `admin_cannot_approve_when_other_officer_exists`: with a second officer → admin `approveLot` → `ForbiddenError`, and the lot is not in the admin queue.
  - An officer of another cooperative → `ForbiddenError`.
  - `terms_locked_at_quote_survive_setting_change`: submit with cut 400 and fee 300; then the admin sets the fee to 250 and the officer sets the cut to 200; approve → `LotFeeTerms { cooperativeCutBps: 400, platformFeeBps: 300 }`; a lot submitted afterwards quotes 200/250.
  - `concurrent_screening_has_one_winner`: `Promise.allSettled([approveLot(a), rejectLot(b)])` → one fulfilled, one rejected with `LOT_NOT_PENDING`; one audit row.
  - `counterLot` with 50000 when the floor is 60000 → `COUNTER_BELOW_FLOOR`; counter 70000 then farmer accepts → `LIVE`, `askKobo` 70000, terms locked; decline → `WITHDRAWN`.
  - `rejectLot` with a 2-character reason → `REASON_REQUIRED`; with a reason → farmer's `getOwnLot` shows `rejectionReason`.
  - `audit_meta_never_contains_floor`: after submit, counter and approve, no audit row's `JSON.stringify(meta)` contains the floor's kobo value.
  - Matrix rows for `lot:screen`, plus `lot:approve` rows for ADMIN with `cooperativeHasOtherOfficer: false` (true) and for an ADMIN who owns the lot (false).
- [ ] **Step 2: Run** `npm test -- tests/integration/lot-screening.test.ts tests/access/policy-matrix.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the service functions and policy rule.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: officer screening with self-approval rule, admin fallback and locked fee terms`.

### Task 8: Screening screens

**Files:**
- Create: `src/app/officer/lots/page.tsx`, `src/app/officer/lots/[id]/page.tsx`, `src/app/officer/lots/[id]/screening-actions.tsx`, `src/app/officer/lots/actions.ts`, `src/app/admin/lots/page.tsx`, `src/app/admin/lots/[id]/page.tsx` (reuses `screening-actions.tsx`)
- Modify: `src/app/farmer/lots/[id]/page.tsx` (counter accept/decline, rejection reason), `src/app/farmer/lots/actions.ts`, `src/components/nav-links.ts`, `messages/*.json`
- Test: nav test

**Interfaces:**
- Consumes: Task 7 service functions.
- Produces:
  - Actions returning `ActionResult`: `approveLotAction({ lotId, minOrderQty })`, `rejectLotAction({ lotId, reason })`, `counterLotAction({ lotId, counterAsk })` (naira string via `toKobo`), `respondToCounterAction({ lotId, accept })`. Each revalidates `/officer/lots`, `/admin/lots`, `/farmer/lots` and `/lots`.
  - The screening detail shows photos, crop, unit, quantity, grade, pickup, ask, floor (labelled "Farmer's lowest price, private"), note, the stored deviation with the board prices, the quoted breakdown, and the three actions; when `canApprove` is false it says "You submitted this lot; another officer or an admin must screen it."
  - Nav: OFFICER gains `{ href: "/officer/lots", labelKey: "screenLots" }`; ADMIN gains `{ href: "/admin/lots", labelKey: "lotQueue" }`.
  - The farmer's lot page shows the counter price with its own take-home breakdown and Accept / Decline buttons, and the rejection reason when rejected.

- [ ] **Step 1: Write the failing test.** Nav: `navLinksFor("OFFICER")` includes `/officer/lots`; `navLinksFor("ADMIN")` includes `/admin/lots` and `/admin/settings`.
- [ ] **Step 2: Run** `npm test -- tests/unit/header-nav.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the pages, actions and copy (error codes mapped to messages, with a fallback).
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS. (The journey is proved end to end in Task 11.)
- [ ] **Step 5: Commit** `feat: officer and admin screening screens; farmer answers counters`.

### Task 9: Revisions and withdrawal

**Files:**
- Modify: `prisma/schema.prisma` (model `LotRevision`), `src/modules/catalog/lots.ts`, `src/modules/catalog/service.ts`, `src/modules/catalog/views.ts`, `src/app/farmer/lots/[id]/page.tsx`, `src/app/farmer/lots/actions.ts`, `src/app/officer/lots/[id]/page.tsx`, `src/app/officer/lots/actions.ts`, `messages/*.json`, `tests/integration/helpers.ts`
- Create: migration `lot_revisions`, `src/app/farmer/lots/[id]/revise-form.tsx`
- Test: `tests/integration/lot-revisions.test.ts`

**Interfaces:**
- Consumes: Tasks 5 and 7 (`approveLot`'s permission check, `askDeviation`, `hasOpenOrders`).
- Produces:
  - `model LotRevision { id, lotId, askKobo Int, quantity Int, floorKobo Int, note String?, deviation Deviation?, status RevisionStatus (PENDING | APPROVED | REJECTED | SUPERSEDED), reason String?, screenedByUserId String?, createdAt, decidedAt DateTime? ; @@index([lotId, status]) }` (`@@map("lot_revision")`).
  - `requestRevision(actor, lotId, input: { askKobo: number; quantity: number; floorKobo: number; note?: string }, now = new Date())`: `lot:own`; lot `LIVE` (`LOT_NOT_LIVE`); same field rules as submission (`FLOOR_ABOVE_ASK`, `NOTE_REQUIRED` from a fresh deviation); `minOrderQty` must stay ≤ the new quantity (`QUANTITY_BELOW_MIN_ORDER`); an earlier PENDING revision becomes SUPERSEDED; audit `lot.revise` `{ lotId, askKobo, quantity }`.
  - `decideRevision(actor, revisionId, input: { approve: boolean; reason?: string }, now = new Date())`: the `lot:approve` rule on its lot; `updateMany where { id, status: "PENDING" }` (`REVISION_NOT_PENDING`); approve copies ask, quantity, floor, note and deviation onto the lot (status stays `LIVE`, `LotFeeTerms` untouched), audit `lot.revision_approve`; reject needs a reason, audit `lot.revision_reject`.
  - `withdrawLot(actor, lotId)`: `lot:own`; from `PENDING_REVIEW`, `COUNTERED` or `LIVE` (`LOT_NOT_WITHDRAWABLE`); `hasOpenOrders(lotId)` true → `ConflictError` `LOT_HAS_OPEN_ORDERS`; pending revisions become SUPERSEDED; audit `lot.withdraw`.
  - `FarmerLot.pendingRevision` and `OfficerLot.pendingRevision`: `{ id; askKobo; quantity; floorKobo; note; deviation; createdAt } | null`; the screening queue also lists LIVE lots with a pending revision.

- [ ] **Step 1: Write the failing tests.** A live lot at 50000 gets a revision to 55000: the public view still says 50000 until an officer approves, then 55000; `LotFeeTerms` unchanged; a second revision request supersedes the first; the farmer-officer cannot approve their own revision (`CANNOT_APPROVE_OWN_LOT`); revision `floorKobo > askKobo` → `FLOOR_ABOVE_ASK`; a revision on a `PENDING_REVIEW` lot → `LOT_NOT_LIVE`; withdraw from `LIVE` → `WITHDRAWN` and the pending revision is SUPERSEDED; withdraw a `REJECTED` lot → `LOT_NOT_WITHDRAWABLE`; with `hasOpenOrders` mocked to true → `LOT_HAS_OPEN_ORDERS`.
- [ ] **Step 2: Run** `npm test -- tests/integration/lot-revisions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the model, migration (`--create-only --name lot_revisions`), service, views and screens (the revision form reuses the live breakdown and warning from Task 6).
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: live lot edits go to the officer as revisions; farmers withdraw lots`.

### Task 10: Public live lots and the expiry job

**Files:**
- Modify: `src/modules/catalog/lots.ts`, `src/modules/catalog/service.ts`, `src/lib/jobs/index.ts`, `vercel.json`, `src/components/app-footer.tsx`, `messages/*.json`
- Create: `src/modules/catalog/job.ts`, `src/app/lots/page.tsx`
- Test: `tests/integration/public-lots.test.ts`, `tests/integration/lot-expiry.test.ts`

**Interfaces:**
- Consumes: `toPublicLot`, `signedUrl`, `lagosDateKey`, `defineJob`.
- Produces:
  - `listLiveLots(now = new Date()): Promise<PublicLot[]>`: public read, no Actor (comment: buyers browse without an account, spec 11); lots `LIVE` in VERIFIED cooperatives with `availableUntil >= lagosDate(lagosDateKey(now))`, newest approval first, at most 50; photo URLs signed for 3600 seconds.
  - `expireLots(now = new Date()): Promise<number>`: `updateMany` lots in `PENDING_REVIEW`, `COUNTERED` or `LIVE` with `availableUntil` before Lagos today → `EXPIRED` (pending revisions SUPERSEDED), one `lot.expire` audit row per lot (actor null), returns the count. Registered as job `lot-expiry`; `vercel.json` gains `{ "path": "/api/cron/lot-expiry", "schedule": "0 4 * * *" }`.
  - `/lots`: cards with photo, crop, quantity and unit, grade, pickup state and LGA, `formatNaira(askKobo)` per unit, minimum order, available until, cooperative name; empty state. The footer gains "Harvest lots". Making an offer is Phase 4; the card says nothing about buying yet.

- [ ] **Step 1: Write the failing tests.** `public-lots.test.ts`: `public_lots_never_contain_floor`: with floor 4321987 on a live lot, `JSON.stringify(await listLiveLots())` contains neither `4321987` nor `floor` nor the farmer's user id or name; pending, countered, rejected and withdrawn lots are absent; `suspended_cooperative_lots_are_hidden`: after `suspendCooperative` the lot is gone and returns after `reinstateCooperative`; `lot_past_available_until_is_hidden_before_job_runs`: with `now` one Lagos day after `availableUntil`, the lot is absent while its status is still `LIVE`. `lot-expiry.test.ts`: `expireLots` at `availableUntil + 1 day` expires live and pending lots and returns 2, leaves a lot ending today alone, writes one `lot.expire` row each; a second call returns 0 and writes nothing; the cron route with `CRON_SECRET` runs `lot-expiry` once per minute slot (follow `jobs.test.ts`).
- [ ] **Step 2: Run** `npm test -- tests/integration/public-lots.test.ts tests/integration/lot-expiry.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the read, the job and its registration, the cron entry, the page and the footer link.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: public list of live lots and the daily lot-expiry job`.

### Task 11: End-to-end journey, seed and docs

**Files:**
- Create: `tests/e2e/lots.spec.ts`, `tests/e2e/fixtures/maize.jpg` (a small real JPEG, under 50 KB)
- Modify: `prisma/seed.ts`, `tests/integration/seed.test.ts`, `docs/superpowers/specs/2026-10-31-agrohub-design.md` (section 12: the fee and maximum cut are decided: 3% and 5% defaults, kept in `Setting` and editable by admins), `docs/architecture.md` (section 5: `Setting` keys and bps strings, `Cooperative.cutBps`, `Lot` quoted terms and `deviation`, `LotPhoto`, `LotRevision`, `CatalogRequest`, `FarmerProfile.crops` as crop ids; section 6: Lot states without DRAFT, counter decline → WITHDRAWN; section 11: fee, maximum cut and deviation threshold now live in `Setting`), `docs/superpowers/plans/2026-10-31-agrohub-roadmap.md` (tick 3.1 to 3.8; note 3.1 is `saleBreakdown` in `money.ts`)

**Interfaces:**
- Consumes: everything above; the cooperative-to-farmer spec's helpers (`completeSignUp`, `signIn`, `addFakeBankAccount`, `clickNav`; move the ones this spec needs into a shared `tests/e2e/journey.ts` rather than copying them).
- Produces: the seed sets the seed cooperative's cut to 500 bps and links the seed farmer to two crops. No seeded lots (photos would need real storage on staging). Re-running adds nothing.

- [ ] **Step 1: Write the failing tests.** `seed.test.ts`: after seeding twice the seed cooperative's `cutBps` is 500 and the seed farmer has 2 crops. `lots.spec.ts`: set up a verified cooperative with an officer, an approved farmer with a bank account, and a board admin's price for Maize per Bag (reuse helpers); the farmer opens "My lots" from the nav, fills the form (Maize, Bag, 30, grade A, ask ₦65,000, floor ₦43,219.87, a date two weeks ahead, `maize.jpg`), sees "You take home per unit" with the figure for 5% cut and 3% fee, and submits; the officer opens "Screen lots", sees the floor, approves with minimum order 5; the farmer sees the lot as live with locked terms "5% / 3%"; a signed-out visitor opens `/lots`, sees Maize, "₦65,000.00" and the cooperative name, and the page text does not contain "43,219.87" or "4321987". Scope locators to `getByRole("main")`.
- [ ] **Step 2: Run** `npm test -- tests/integration/seed.test.ts`, then `npx playwright test tests/e2e/lots.spec.ts` (never at the same time as integration tests: they share `agrohub_test`). Expected: FAIL.
- [ ] **Step 3: Implement** the shared helpers, the seed additions and the doc edits.
- [ ] **Step 4: Run** the same commands, the full `npx playwright test`, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `test: lot journey end to end; seed and docs for Phase 3`.

**Phase done when:** on staging (after the migrations are applied), a farmer submits a lot, an officer approves it, it shows on `/lots` with its fee terms locked, and no public output carries the floor. Then open the PR "Phase 3: harvest lots and officer screening" to `main`, listing every decision above under "Choices to check".
