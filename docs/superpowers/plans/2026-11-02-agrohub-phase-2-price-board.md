# AgroHub Phase 2: Crops, Units and the Price Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A board admin keeps the crop and unit lists and records weekly prices per crop, unit and market; anyone (farmers included) can read the price board; a pure `priceDeviation` check is ready for Phase 3's lot warning.

**Architecture:** Crops and units live in `src/modules/catalog` (architecture section 2 puts them there); price points and the deviation check live in `src/modules/board`. Board-admin screens under `src/app/board/`, the public board at `src/app/prices/`. Pages call server actions; actions call services; services call `can()` first. Every new screen uses the redesign kit (`src/components/ui/`, tokens in `src/styles/tokens.css`).

**Tech Stack:** As Phase 1. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-31-agrohub-design.md` sections 3 (board admin), 6.3 (neutral price warning), 6.4, 6.14 (board admin home), 8 (audit of price changes, 2FA). Roadmap: `2026-10-31-agrohub-roadmap.md` Phase 2. Architecture: `docs/architecture.md` sections 2, 5, 11 (deviation threshold default 20%).

## Global Constraints

- Money is integer kobo; percentages are integer basis points. No floats. Arithmetic and formatting only in `src/lib/money.ts` (`toKobo`, `formatNaira`).
- Business logic only in `src/modules/*/service.ts`. Every service function takes an `Actor` and calls `can(actor, action, resource)` first. The one exemption, the public board read, carries a comment saying so.
- Board admins enter weekly prices per crop and market. The board is visible to farmers and buyers.
- Crops and units (kg, bag, tonne, basket and so on) come from a list the board admin maintains.
- Two-factor authentication is mandatory for every admin role, board admin included (already enforced by `getActor`).
- Price changes write to the append-only audit log. Audit `meta` holds ids, kobo amounts and statuses only.
- All user-facing strings in `messages/*.json`, keys mirrored in all five files.
- Price-deviation threshold starting default: 20% (2000 bps). The warning is neutral (`'OK' | 'HIGH' | 'LOW'`, no judgement words).
- Migrations are created with `npx prisma migrate dev --create-only` and reviewed; never `prisma db push`.
- Before each commit: `npm run lint`, `npm run typecheck`, `npm test`. No Co-Authored-By or "Generated with" lines.

## Review Focus

1. The board admin double-submits the same price, or corrects it later the same week: one row per crop, unit, market and week, updated in place, with a `price.update` audit row showing old and new kobo (Task 2, `duplicate_entry_updates_one_row`).
2. The same market typed two ways ("Bodija Market", " bodija  market"): treated as one market (Task 2, `market_names_are_normalized`).
3. A price entered late Sunday night Lagos time: it belongs to that week, not the next, and a future week is refused (Task 2, `week_of_uses_lagos_time`, `future_week_is_refused`).
4. A crop or unit is deactivated: new prices for it are refused and the public board stops showing it (Task 2, `inactive_crop_or_unit_is_refused`; Task 4, `public_board_hides_inactive_crops`).
5. An ADMIN who is not a board admin, or a board admin without 2FA, tries to change crops or prices: refused (Task 1 matrix rows; Task 2, `admin_cannot_record_price`).

## Decisions this plan makes (the spec is silent)

- **Price points carry a unit.** The roadmap's `recordPrice(actor, { cropId, market, weekOf, priceKobo })` gains `unitId`: a price for maize means nothing without "per bag" or "per kg", and Phase 3 compares a lot's ask in its unit. Uniqueness is `(cropId, unitId, marketKey, weekOf)`.
- **Recording is publishing.** There is no draft state; a recorded price is on the public board at once. A second entry for the same key updates it.
- **Markets are free text**, normalized (trim, collapse spaces) for display and lower-cased into `marketKey` for uniqueness. The latest spelling wins for display. A managed market list is left for later.
- **Weeks start Monday in Africa/Lagos time (UTC+1, no DST)** and are stored as a `@db.Date`. Past weeks are allowed (corrections); weeks after the current one are refused.
- **Crops and units are deactivated, never deleted**, since lots will reference them. Names are unique case-insensitively.
- **The public board** shows, per active crop/unit/market, the latest week's price and the change from the previous recorded week. It is at `/prices`, needs no sign-in, and is linked from the footer and the farmer and board-admin nav.
- **The deviation threshold is a constant** (`DEFAULT_DEVIATION_THRESHOLD_BPS = 2000` in `board/deviation.ts`). The `Setting` table in architecture section 5 is not built yet; Phase 3 can add it when the warning is wired in.
- **Farmer profile crops stay free text.** Moving the join form to the crop list is deferred to Phase 3, where lots need the crop id anyway; switching now would block joining on staging until a board admin has created crops.

---

### Task 1: Crops and units

**Files:**
- Modify: `prisma/schema.prisma` (models `Crop`, `Unit`), `src/modules/identity/policies.ts`, `tests/access/policy-matrix.test.ts`, `docs/superpowers/plans/2026-10-31-agrohub-roadmap.md` (tick Phase 1's eight boxes; Phase 1 is merged and its staging journey, uploads included, is confirmed)
- Create: migration `crops_units`, `src/modules/catalog/schema.ts`, `src/modules/catalog/service.ts`, `src/modules/catalog/views.ts`
- Test: `tests/integration/catalog.test.ts`

**Interfaces:**
- Produces:
  - `model Crop { id, name, nameKey @unique, active Boolean @default(true), createdAt, updatedAt }` (`@@map("crop")`); `Unit` the same shape (`@@map("unit")`). `nameKey` is the normalized name lower-cased.
  - Action `"catalog:manage"`: `actor.role === "BOARD_ADMIN"`. The existing `"price:write"` stays as is.
  - `normalizeName(value: string): string` (trim, collapse inner whitespace) in `catalog/schema.ts`; `nameInput` zod: 1 to 60 chars after normalizing.
  - `createCrop(actor, { name }): Promise<CatalogItem>`, `renameCrop(actor, id, { name })`, `setCropActive(actor, id, active: boolean)`, and the same three for units (`createUnit`, `renameUnit`, `setUnitActive`). Duplicate `nameKey` → `ConflictError` code `CROP_EXISTS` / `UNIT_EXISTS`; unknown id → `NotFoundError`. Each writes an audit row (`crop.create`, `crop.rename`, `crop.activate`, `crop.deactivate`, and `unit.*`).
  - `listCatalog(actor): Promise<{ crops: CatalogItem[]; units: CatalogItem[] }>` (all, for board admins, sorted by name).
  - `listActiveCatalog(): Promise<{ crops: CatalogItem[]; units: CatalogItem[] }>`: read-only reference data for forms and the public board; comment the Actor exemption.
  - `CatalogItem = { id: string; name: string; active: boolean }` from `toCatalogItem` in `views.ts`.

- [ ] **Step 1: Write the failing tests.** Matrix: five rows for `catalog:manage` (only BOARD_ADMIN true). `catalog.test.ts`:
  - `createCrop` by a board admin returns `{ name: "Maize", active: true }` and writes one `crop.create` audit row;
  - `createCrop({ name: "  maize " })` after "Maize" → `ConflictError` `CROP_EXISTS`; same for units with "Bag"/"bag";
  - `createCrop` by an ADMIN actor → `ForbiddenError`;
  - `setCropActive(actor, id, false)` removes it from `listActiveCatalog().crops` but not from `listCatalog`;
  - `renameCrop` to another crop's name → `CROP_EXISTS`.
- [ ] **Step 2: Run** `npm test -- tests/integration/catalog.test.ts tests/access/policy-matrix.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the models and migration (`npx prisma migrate dev --create-only --name crops_units`, review, then `npx prisma migrate dev`), the policy rule and the service. Tick the Phase 1 roadmap boxes. Add `crop`, `unit` to `cleanDatabase` in `tests/integration/helpers.ts`.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: crop and unit lists kept by board admins` (body: Phase 1 roadmap boxes ticked; names unique case-insensitively; deactivate, never delete).

### Task 2: Weekly price points

**Files:**
- Modify: `prisma/schema.prisma` (model `PricePoint`, relations on `Crop`, `Unit`), `tests/integration/helpers.ts`
- Create: migration `price_points`, `src/modules/board/week.ts`, `src/modules/board/schema.ts`, `src/modules/board/service.ts`, `src/modules/board/views.ts`
- Test: `tests/unit/week.test.ts`, `tests/integration/board.test.ts`

**Interfaces:**
- Consumes: `Crop`, `Unit`, `normalizeName` from Task 1.
- Produces:
  - `model PricePoint { id, cropId, unitId, market, marketKey, weekOf DateTime @db.Date, priceKobo Int, recordedByUserId, createdAt, updatedAt; @@unique([cropId, unitId, marketKey, weekOf]); @@index([weekOf]) }` (`@@map("price_point")`). `priceKobo` is `Int` (max ₦20,000,000 = 2,000,000,000 kobo fits).
  - `weekStart(at: Date): Date` in `week.ts`: Monday 00:00 UTC of the Lagos (UTC+1) week containing `at`. `toWeekKey(d: Date): string` → `"YYYY-MM-DD"`.
  - `recordPriceInput` zod: `cropId`, `unitId`, `market` (1 to 80 chars after `normalizeName`), `weekOf` (`YYYY-MM-DD`), `priceKobo` (integer, 1 to 2,000,000,000).
  - `recordPrice(actor, input: { cropId: string; unitId: string; market: string; weekOf: string; priceKobo: number }, now = new Date()): Promise<BoardEntry>`: `can(actor, "price:write")`; crop and unit must exist and be active (`ValidationError` `CROP_INACTIVE` / `UNIT_INACTIVE`); `weekOf` normalized with `weekStart`; a week after `weekStart(now)` → `ValidationError` `FUTURE_WEEK`. Upserts on the unique key. New row → audit `price.record` `{ cropId, unitId, weekOf, priceKobo }`; existing row with a different price → audit `price.update` `{ ..., fromKobo, toKobo }`; same price → no audit row.
  - `listWeek(actor, weekOf: string): Promise<BoardEntry[]>` for the board-admin screen (`price:write`), sorted by crop, unit, market.
  - `BoardEntry = { id: string; crop: string; unit: string; market: string; weekOf: string; priceKobo: number }` via `toBoardEntry` in `views.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `week.test.ts`: `weekStart(new Date("2026-11-08T22:30:00Z"))` (Sunday 23:30 Lagos) → `2026-11-02`; `weekStart(new Date("2026-11-08T23:30:00Z"))` (Monday 00:30 Lagos) → `2026-11-09`; a Wednesday → its Monday.
  - `board.test.ts`:
    - `recordPrice` with `weekOf: "2026-11-04"` stores `weekOf` `2026-11-02` and writes one `price.record` row;
    - `duplicate_entry_updates_one_row`: recording 50000 then 52000 for the same key leaves one row at 52000 and a `price.update` audit row with `fromKobo: 50000, toKobo: 52000`; recording 52000 again adds no audit row;
    - `market_names_are_normalized`: "Bodija Market" then " bodija  market" → one row, `market` = "bodija market";
    - `week_of_uses_lagos_time` and `future_week_is_refused`: with `now` = `2026-11-08T22:30:00Z`, `weekOf: "2026-11-09"` → `FUTURE_WEEK`; `"2026-11-02"` is accepted;
    - `inactive_crop_or_unit_is_refused`: deactivated crop → `CROP_INACTIVE`; deactivated unit → `UNIT_INACTIVE`;
    - `admin_cannot_record_price`: an ADMIN actor → `ForbiddenError`;
    - `priceKobo: 0` and `priceKobo: 1.5` → `ValidationError`.
- [ ] **Step 2: Run** `npm test -- tests/unit/week.test.ts tests/integration/board.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the model, migration (`--create-only --name price_points`), `week.ts`, schema and service. Add `price_point` to `cleanDatabase` (before `crop` and `unit`).
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: weekly price points per crop, unit and market` (body: unitId added to recordPrice; Lagos Monday weeks; recording publishes).

### Task 3: Price deviation check

**Files:**
- Create: `src/modules/board/deviation.ts`
- Test: `tests/unit/deviation.test.ts`

**Interfaces:**
- Produces: `priceDeviation(askKobo: number, boardKobo: number, thresholdBps: number): 'OK' | 'HIGH' | 'LOW'` and `DEFAULT_DEVIATION_THRESHOLD_BPS = 2000`. HIGH when `(ask - board) * 10000 > board * threshold`, LOW when `(board - ask) * 10000 > board * threshold`, else OK; computed with BigInt (no division, no floats). Non-safe-integer or negative input, or `boardKobo <= 0`, → `RangeError`.

- [ ] **Step 1: Write the failing test** as a table with threshold 2000: `(120000, 100000)` → OK (exactly 20%); `(120001, 100000)` → HIGH; `(80000, 100000)` → OK; `(79999, 100000)` → LOW; `(100000, 100000)` → OK; `(1, 100000, 0)` → LOW and `(100000, 100000, 0)` → OK; `(100, 0)` throws `RangeError`; `(1.5, 100)` throws `RangeError`. Add a fast-check property: with ask = board, the result is always OK.
- [ ] **Step 2: Run** `npm test -- tests/unit/deviation.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `deviation.ts`.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: neutral price deviation check against the board`.

### Task 4: Public price board

**Files:**
- Modify: `src/modules/board/service.ts`, `src/modules/board/views.ts`, `src/components/nav-links.ts`, `src/components/app-footer.tsx`, `messages/*.json`
- Create: `src/app/prices/page.tsx`
- Test: `tests/integration/board.test.ts` (new cases), `tests/unit/nav-links.test.ts` (create if absent, else extend)

**Interfaces:**
- Consumes: `PricePoint` and `weekStart`/`toWeekKey` from Task 2.
- Produces:
  - `listPublicBoard(filter: { cropId?: string } = {}): Promise<PublicBoardRow[]>`: public read, no Actor (comment the exemption). One row per active crop, active unit and `marketKey`: the latest week's price and the most recent earlier week's price. Sorted by crop, unit, market.
  - `PublicBoardRow = { crop: string; unit: string; market: string; weekOf: string; priceKobo: number; previousKobo: number | null }` via `toPublicBoardRow`. It never carries user ids.
  - Nav: `NavLabelKey` gains `"prices"`; FARMER links gain `{ href: "/prices", labelKey: "prices" }`.
  - `/prices`: crop filter (`?crop=<id>`, a plain GET form, works without JS), a table on wide screens and stacked cards on phones, prices with `formatNaira`, change shown as `+₦2,000.00` / `-₦1,000.00` / "No earlier price", week shown as "Week of 2 Nov 2026". Empty state copy when nothing is recorded. Footer gets a "Price board" link.

- [ ] **Step 1: Write the failing tests.** `board.test.ts`:
  - `public_board_shows_latest_and_previous`: prices for weeks 2026-10-19 (48000) and 2026-10-26 (50000) for one key → one row `{ weekOf: "2026-10-26", priceKobo: 50000, previousKobo: 48000 }`;
  - `public_board_hides_inactive_crops`: after `setCropActive(..., false)` its rows are gone;
  - `cropId` filter returns only that crop's rows;
  - `JSON.stringify(rows)` does not contain the recording user's id.
  - Nav test: `navLinksFor("FARMER")` includes `/prices`.
- [ ] **Step 2: Run** `npm test -- tests/integration/board.test.ts tests/unit/nav-links.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the read (two queries or one window query; keep it in the service), the page with the kit, the nav and footer links and the strings in all five message files.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: public price board at /prices`.

### Task 5: Board admin screens and the end-to-end journey

**Files:**
- Create: `src/app/board/page.tsx` (price entry and this week's prices), `src/app/board/crops/page.tsx` (crops and units), `src/app/board/actions.ts`, `src/app/board/price-form.tsx`, `src/app/board/crops/catalog-panel.tsx`, `tests/e2e/price-board.spec.ts`
- Modify: `src/components/nav-links.ts`, `messages/*.json`, `tests/unit/nav-links.test.ts`

**Interfaces:**
- Consumes: Task 1 catalog service, Task 2 `recordPrice`/`listWeek`, Task 4 `/prices`; e2e helpers `tests/e2e/grant.ts` and `tests/e2e/totp.ts`.
- Produces:
  - Server actions returning `ActionResult` (actor from `requireActor()`, never from the client): `createCropAction`, `renameCropAction`, `setCropActiveAction`, the three unit equivalents, and `recordPriceAction({ cropId, unitId, market, weekOf, price })` where `price` is a naira string converted with `toKobo` (a `SyntaxError` becomes `ValidationError` `INVALID_PRICE`). Each revalidates `/board`, `/board/crops` and `/prices`.
  - Pages call `requireActorForPage()` and `notFound()` unless the role is BOARD_ADMIN. The price form lists active crops and units, defaults the week to the current Lagos week, and shows the week's entries below with their prices. Error codes map to messages (`CROP_EXISTS`, `UNIT_EXISTS`, `FUTURE_WEEK`, `CROP_INACTIVE`, `UNIT_INACTIVE`, `INVALID_PRICE`, fallback).
  - Nav: BOARD_ADMIN links `/board` (`"priceEntry"`), `/board/crops` (`"cropsUnits"`), `/prices` (`"prices"`).

- [ ] **Step 1: Write the failing tests.** Nav test: `navLinksFor("BOARD_ADMIN")` hrefs equal `["/board", "/board/crops", "/prices"]`. `price-board.spec.ts`: a user granted BOARD_ADMIN signs in and enrols TOTP; on `/board/crops` adds crop "Maize" and unit "Bag"; on `/board` records Maize, Bag, "Bodija Market", ₦52,000 for the current week and sees it listed; a second user signed in as an approved farmer (reuse the cooperative-to-farmer spec's setup helpers) opens `/prices` from the nav and sees "Maize", "Bag", "₦52,000.00"; a signed-out visitor sees the same row at `/prices`. Scroll to top before nav clicks (`clickNav` helper).
- [ ] **Step 2: Run** `npm test -- tests/unit/nav-links.test.ts`, then `npx playwright test tests/e2e/price-board.spec.ts` (not at the same time as integration tests: they share `agrohub_test`). Expected: FAIL.
- [ ] **Step 3: Implement** the actions, pages and forms with the kit (phone-first; inputs at least 44px tall; labels from messages).
- [ ] **Step 4: Run** the same commands, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: board admin screens for crops, units and weekly prices`.

### Task 6: Seed data and docs

**Files:**
- Modify: `prisma/seed.ts`, `tests/integration/seed.test.ts`, `docs/architecture.md` (section 5: `PricePoint` gains `unitId`, `marketKey`; section 11: threshold constant until `Setting` exists), `docs/superpowers/plans/2026-10-31-agrohub-roadmap.md` (tick Phase 2 boxes, noting `recordPrice` takes `unitId`)

**Interfaces:**
- Consumes: Tasks 1 and 2 services.
- Produces: the seed adds a board admin (`seed-board@example.com`, two-factor off), crops Maize, Sorghum, Rice, Cassava, Yam, Soybeans, units kg, bag, tonne, basket, and two weeks of prices for three crops at two markets. Re-running adds nothing.

- [ ] **Step 1: Write the failing test** in `seed.test.ts`: after seeding twice there are 6 crops, 4 units, one BOARD_ADMIN membership and 12 price points.
- [ ] **Step 2: Run** `npm test -- tests/integration/seed.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the seed additions (through the services, with a board-admin Actor built for the seed) and the doc edits.
- [ ] **Step 4: Run** the same command, then `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: seed crops, units and a demo price board; docs for Phase 2`.

**Phase done when:** on staging (after the migrations are applied), a board admin with 2FA adds crops and units and records prices, and a farmer sees them on `/prices`.
