# App-wide redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every real screen outside `/demo` uses the demo's tokens, type and components.

**Architecture:** Demo palette and radii go into `src/styles/tokens.css` and are exposed as Tailwind utilities in `globals.css`. The demo's `ui.tsx` is ported into `src/components/ui/`. The root layout becomes the demo's frame, pill nav and wordmark footer. Each screen is then restyled with the kit; logic and copy are not touched.

**Tech Stack:** Next 16 App Router, React 19, Tailwind v4 (`@theme inline`), next-intl, `next/font/google` (Geist), `next/image`, vitest (node), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-app-redesign-design.md`. Visual source: `DESIGN.md` and `git show demo-screens:src/app/demo/{demo.css,_components/ui.tsx,_components/demo-nav.tsx,layout.tsx}`.

## Global Constraints

- Work only in worktree `C:/Users/jonat/Dev/agrohub-redesign`, branch `redesign/app-ui`. Never edit `C:/Users/jonat/Dev/agrohub` (it holds uncommitted work on `demo-screens`).
- Do not touch `src/lib/storage.ts` or `src/lib/action-result.ts`.
- No new npm dependency. Geist comes from `next/font/google`.
- No copy, route, service, action or schema changes. New message keys go in `messages/en.json`, and as `""` in `ha.json`, `ig.json`, `pcm.json` and `yo.json`.
- Never write "escrow". Light only: no `dark:` classes and no dark token set.
- No border or shadow on a surface at rest; separate surfaces with tone steps. Every tap target is at least 44px (`min-h-11`). Primary page actions are 48px (`min-h-12`).
- Running text in `text-ink`. `text-ink-soft` is only for hints and metadata. No tracked uppercase.
- Animate only transform and opacity, on `var(--ease)`. Under `prefers-reduced-motion`, fade only.
- Before each commit, run `npm run lint`, `npm run typecheck` and `npm test`. Stage files explicitly (never `git add -A`). No Co-Authored-By trailers, no "Generated with" lines.
- Never run Playwright and integration tests at the same time (shared `agrohub_test` DB).

## Review Focus

1. Keyboard user on the phone menu: Tab must not reach hidden menu links when the menu is closed, and Escape closes it and returns focus to the toggle. Task 4 tests the toggle state helper; e2e covers Escape.
2. Phone at 390px on a long cooperative name or email: no horizontal scroll. Use `min-w-0` and `break-words` on card titles. Task 9 checks it visually.
3. Signed-out user: the nav renders nothing, but the footer and the sign-in pill must still render. The existing `auth.spec.ts` sign-in flow covers this; Task 4 adds an assertion.
4. Field with a server error *and* a hint: both messages must be announced. The Task 3 `Field` test asserts that `aria-describedby` holds both ids.
5. Phone viewport must not download the auth photos. Task 3 renders `ClippedPhoto` inside `hidden md:block`; Task 9 checks the network requests at 390px.

---

### Task 1: Tokens, type and font

**Files:**
- Modify: `src/styles/tokens.css` (full rewrite)
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx` (font only; the `<html>` className)

**Interfaces:**
- Produces utilities: `bg-ground bg-paper bg-step bg-step-deep bg-lime bg-forest bg-warn-soft`, the matching `text-*` utilities (`ink`, `ink-soft`, `lime-ink`, `forest-ink`, `good`, `warn`, `bad`), and `outline-bad`. Also `rounded-input rounded-tile rounded-inner rounded-panel rounded-frame`, the classes `heading-1` to `heading-6`, `title-2` to `title-4`, `body-1`, `body-3`, `body-5`, `body-6`, `button-md`, `button-sm`, `caption-2`, `caption-4`, and `.press`, plus the CSS vars `--ease` and `--ease-out`.

- [ ] **Step 1:** Rewrite `tokens.css` with the token table in spec §1 (values verbatim), and remove the dark `@media` block. Set `:root { color-scheme: light }` and `--font-body: var(--font-geist), ui-sans-serif, system-ui, sans-serif`.
- [ ] **Step 2:** In `globals.css`, replace the `@theme inline` block with the new color and radius tokens (`--color-ground: var(--color-ground)` and so on; `--radius-panel` and so on). Keep `--font-sans: var(--font-body)`. Port from `demo.css` the named text styles (and the `max-width: 767px` overrides), `.press` and the `press-lift` hover, and the `h1`–`h4` `text-wrap: balance` / `p` `pretty` rules. Set `body { background: var(--color-ground); color: var(--color-ink); font-variant-numeric: tabular-nums }`, `:focus-visible { outline: 2px solid var(--color-ink); outline-offset: 2px }`, and a `prefers-reduced-motion: reduce` block that sets `transition-property: opacity` and `animation: none` on `*`.
- [ ] **Step 3:** In `layout.tsx`, add `const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" })` and put `geist.variable` on `<html>`.
- [ ] **Step 4:** Run `npm run lint && npm run typecheck && npm test`. Expected: all pass. (Old utilities like `bg-surface` silently stop generating; later tasks replace them.)
- [ ] **Step 5:** Commit with the message `feat(ui): demo palette, radii, type scale and Geist in the token slot`.

### Task 2: UI kit

**Files:**
- Create: `src/components/ui/button.tsx`, `panel.tsx`, `chip.tsx`, `page-heading.tsx`, `icons.tsx`, `index.ts` (barrel)
- Test: `tests/unit/ui-kit.test.ts`

**Interfaces:**
- Produces:
  - `Button(props: ComponentProps<"button"> & { tone?: Tone; size?: "md" | "lg" })`
  - `ButtonLink(props: ComponentProps<typeof Link> & { tone?: Tone; size?: "md" | "lg" })`
  - `type Tone = "ink" | "lime" | "step" | "paper"`
  - `buttonClass(tone?: Tone, size?: "md" | "lg"): string`, exported for `<button type="submit">` in forms that can't use `Button`
  - `Panel({ children, className?, as?: "section" | "div" })`, paper, `rounded-panel p-6 md:p-8`
  - `Card({ children, className?, tone?: "step" | "paper" })`, `rounded-inner p-4 md:p-6`, default step
  - `Chip({ children, tone?: "step" | "lime" | "forest" | "warn" })`
  - `PageHeading({ title: string; lead?: string; children?: ReactNode })`, renders `h1.heading-3`
  - `ArrowRight`, `ArrowUpRight`, `Check`, `({ className? }) => svg` with `aria-hidden`

- [ ] **Step 1: Write the failing tests.** Use `renderToStaticMarkup(createElement(...))` from `react-dom/server`. The `.ts` file has no JSX. `ButtonLink` needs no router for static render.

```ts
it("button defaults to type=button and passes disabled", () => {
  const html = renderToStaticMarkup(createElement(Button, { disabled: true }, "Go"));
  expect(html).toContain('type="button"');
  expect(html).toContain("disabled");
});
it("button tone lime uses lime fill and lime ink", () => {
  expect(buttonClass("lime")).toMatch(/bg-lime/);
  expect(buttonClass("lime")).toMatch(/text-lime-ink/);
});
it("lg buttons are 48px", () => expect(buttonClass("ink", "lg")).toMatch(/min-h-12/));
it("page heading renders one h1 with the lead", () => {
  const html = renderToStaticMarkup(createElement(PageHeading, { title: "Farmers", lead: "Approve new members" }));
  expect(html.match(/<h1/g)).toHaveLength(1);
  expect(html).toContain("Approve new members");
});
it("chip forest tone", () => {
  expect(renderToStaticMarkup(createElement(Chip, { tone: "forest" }, "Verified"))).toMatch(/bg-forest/);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/ui-kit.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the kit by porting the demo's `ui.tsx` (`TONES`, `BUTTON`, `Chip` tones), replacing `var(--d-*)` with the Task 1 utilities. Hover fills: ink `hover:bg-[#2a3028]`, lime `hover:bg-[#d0e45c]`, paper `hover:bg-step`, step `hover:bg-step-deep`. Size `md` is `min-h-11 px-5 button-md`; `lg` is `min-h-12 px-6 button-md`.
- [ ] **Step 4:** Run the test again. Expected: PASS.
- [ ] **Step 5:** Run lint, typecheck and `npm test`, then commit with `feat(ui): port the demo's button, panel, card, chip and heading kit`.

### Task 3: Form pieces, photographs and auth card

**Files:**
- Modify: `src/components/auth-ui.tsx`
- Create: `src/components/ui/clipped-photo.tsx`, `src/components/ui/photo-credits.ts`
- Create: `public/photos/farmer-at-harvest.jpg`, `cooperative.jpg`, `maize.jpg` (via `git show demo-screens:public/demo/<name>.jpg > public/photos/<name>.jpg`, run through Bash as a binary-safe redirect)
- Test: `tests/unit/auth-ui.test.ts`

**Interfaces:**
- Consumes: `Panel`, `buttonClass` from Task 2.
- Produces:
  - `AuthCard({ title, children, photo?: PhotoKey, lead?: string })`
  - `Field({ label, hint?, error?: string, id, ...input })`
  - `SubmitButton({ pending, label, pendingLabel })` (unchanged)
  - `FormError({ message })` (unchanged)
  - `type PhotoKey = "harvest" | "cooperative" | "maize"`
  - `PHOTOS: Record<PhotoKey, { src: string; alt: string; credit: { what; by; license; url } }>`, in `photo-credits.ts`
  - `ClippedPhoto({ photo: PhotoKey; caption: string })`
  - `PhotoCredit({ photo: PhotoKey })`, one `caption-2` line linking the source

- [ ] **Step 1: Write the failing tests.**

```ts
it("field links hint and error and marks invalid", () => {
  const html = renderToStaticMarkup(createElement(Field, { id: "email", label: "Email", hint: "We send a link", error: "Enter an email" }));
  expect(html).toContain('aria-describedby="email-hint email-error"');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain('id="email-error"');
});
it("field without hint or error has no aria-describedby", () => {
  expect(renderToStaticMarkup(createElement(Field, { id: "x", label: "X" }))).not.toContain("aria-describedby");
});
it("form error is an alert and renders nothing for null", () => {
  expect(renderToStaticMarkup(createElement(FormError, { message: "Wrong code" }))).toContain('role="alert"');
  expect(renderToStaticMarkup(createElement(FormError, { message: null }))).toBe("");
});
it("auth card puts the photo in a desktop-only column", () => {
  const html = renderToStaticMarkup(createElement(AuthCard, { title: "Sign in", photo: "harvest" }, "form"));
  expect(html).toMatch(/hidden[^"]*md:block/);
});
it("every photo has alt text and a credit url", () => {
  for (const p of Object.values(PHOTOS)) { expect(p.alt.length).toBeGreaterThan(10); expect(p.credit.url).toMatch(/^https:\/\/commons\.wikimedia\.org/); }
});
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/auth-ui.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Credits come from the demo's `PHOTO_CREDITS`: harvest is "Farmer at harvest" by Photobyamin (CC BY-SA 4.0); cooperative is "Nigeria farmer cooperative" by USAID in Africa (public domain). For maize, run `git show demo-screens:src/app/demo/_lib/data.ts | grep -n maize` to find which credit it uses, and copy that one.
  - `Field`: input `min-h-12 w-full rounded-input bg-step px-4 body-3 text-ink`, with `outline-2 outline-bad` when `error` is set. Label `title-4`. Hint `body-6 text-ink-soft`. Error `body-6 text-bad`.
  - `FormError`: `rounded-tile bg-[#f7e3de] px-4 py-3 body-6 text-ink` with a 4px `bg-bad` left bar as a flex child. That bar is a tone mark, not a border.
  - `SubmitButton`: `buttonClass("ink","lg")` plus `w-full`.
  - `AuthCard`: `<main id="main">` holding a `grid gap-2 md:grid-cols-12`. The form `Panel` takes `md:col-span-7` (`md:col-span-12` with no photo, inner `max-w-md`). The photo column is `hidden md:block md:col-span-5`. Title `heading-3`.
  - `ClippedPhoto`: port the demo's notch from `demo.css` `.notch-corner` (`tl` only) into `globals.css`, swapping `--d-paper` for `--color-paper`. Use `next/image` with `fill`, `sizes="(min-width: 768px) 40vw, 0px"` and `loading="lazy"`, a `bg-gradient-to-t from-black/65 via-black/10 to-transparent` scrim, and the caption in white `title-3` at the bottom. Below the panel, show `PhotoCredit`.
- [ ] **Step 4:** Run the test again. Expected: PASS.
- [ ] **Step 5:** Run lint, typecheck and `npm test`, then commit with `feat(ui): demo form fields, auth card and clipped photographs` (staging `public/photos/*.jpg` explicitly).

### Task 4: App shell (frame, pill nav, phone menu, footer)

**Files:**
- Modify: `src/app/layout.tsx`, `src/components/role-switcher.tsx`, `src/components/sign-out-button.tsx`
- Create: `src/components/app-nav.tsx` (client), `src/components/app-footer.tsx` (server), `src/components/nav-current.ts` (pure)
- Modify: `messages/{en,ha,ig,pcm,yo}.json`, adding `nav.openMenu`, `nav.closeMenu`, `footer.about`, `footer.privacy`, `footer.skip`
- Test: `tests/unit/header-nav.test.ts` (extend), `tests/e2e/auth.spec.ts` (one assertion)

**Interfaces:**
- Consumes: `buttonClass`, `Chip` from Task 2. `NavLink` from `nav-links.ts`.
- Produces:
  - `isCurrent(pathname: string, href: string): boolean`: true on an exact match, or when `pathname` starts with `href + "/"`
  - `AppNav({ links: { href: string; label: string }[]; label: string; openLabel: string; closeLabel: string; extras?: ReactNode })`
  - `AppFooter({ signedIn: boolean })`

- [ ] **Step 1: Write the failing tests.**

```ts
describe("isCurrent", () => {
  it("matches exact and nested paths", () => {
    expect(isCurrent("/officer/farmers", "/officer/farmers")).toBe(true);
    expect(isCurrent("/admin/cooperatives/abc", "/admin/cooperatives")).toBe(true);
  });
  it("does not match a shared prefix", () => {
    expect(isCurrent("/farmers-old", "/farmer")).toBe(false);
    expect(isCurrent("/officer/invites", "/officer/farmers")).toBe(false);
  });
});
```

In `auth.spec.ts`, after the existing successful officer sign-in lands on `/officer/onboarding`, add:

```ts
await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My cooperative" })).toHaveAttribute("aria-current", "page");
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/header-nav.test.ts`. Expected: FAIL (`isCurrent` missing).
- [ ] **Step 3: Implement.**
  - Layout: `body` is `min-h-full`; a skip link (`sr-only focus:not-sr-only`, ink pill) goes to `#main`. The frame is `mx-auto w-full max-w-[1360px] p-2 md:p-4`, inside it `rounded-frame bg-paper p-2 md:p-3`. The header is `flex items-center justify-between gap-2 rounded-panel px-2 py-2`, holding the wordmark `Link href="/"` (`heading-6`), then `NavSlot`, then `SwitcherSlot` and `AccountSlot` passed into `AppNav.extras` so the phone menu shows them too. When there are no links (signed out), render the extras in place. `{children}` goes in a plain `div className="mt-2"`, since pages own `<main>`. `AppFooter` comes last.
  - `AppNav` (client): use `usePathname()` for `aria-current`. Desktop shows a `hidden md:flex` pill list (`bg-step`, current `bg-ink text-paper`). Phones get a 44px round toggle with `aria-expanded`/`aria-controls` and two bars that morph into a cross. Port this and the full-height `bg-paper/95 backdrop-blur-xl` panel from `demo-nav.tsx` and the `.menu-link` stagger from `demo.css` into `globals.css`. When closed, the panel has `hidden` or `inert`, so its links can't be reached by Tab. It closes on Escape (focus returns to the toggle) and on a pathname change.
  - `RoleSwitcher`: the select becomes `min-h-11 rounded-full bg-step px-4 title-4 text-ink`, its label `sr-only` on phones and `caption-4 text-ink-soft` from md up. Logic unchanged.
  - `SignOutButton`: `buttonClass("step")`. The signed-out `AccountSlot` link uses `buttonClass("ink")`.
  - `AppFooter`: port `DemoFooter` without the demo-only line and photo credits. Show the `footer.about` line ("AgroHub helps farmer cooperatives sell their harvests together. Buyers pay upfront and the payment is held until delivery is confirmed."), pill links for `/privacy` and, when signed out, `/sign-in`, then the `aria-hidden` wordmark.
- [ ] **Step 4:** Run the unit test. Expected: PASS. Run `npm run lint && npm run typecheck && npm test`. Expected: PASS (including i18n key parity).
- [ ] **Step 5:** Commit with `feat(ui): demo frame, pill navigation, phone menu and wordmark footer`. (Playwright runs in Task 9.)

### Task 5: Public and auth screens

**Files:**
- Modify: `src/app/page.tsx`, `src/app/privacy/page.tsx`, `src/app/(auth)/sign-in/page.tsx`, `sign-in-form.tsx`, `sign-up/page.tsx`, `sign-up-form.tsx`, `two-factor/page.tsx`, `two-factor-form.tsx`, `verified/page.tsx`, `src/app/join/[token]/page.tsx`, `profile-form.tsx`, `src/app/bank/confirm/page.tsx`, `confirm-form.tsx`

**Interfaces:**
- Consumes: Task 2 kit; `AuthCard` (`photo`), `Field`, `SubmitButton`, `FormError` from Task 3.

- [ ] **Step 1:** Restyle per spec §4.
  - Sign-in gets `photo="harvest"`, sign-up `"cooperative"`, join `"maize"`. Each photo caption is a new `auth.photoCaption.*` message key in all five files: "Members sell together and earn more", "Register your cooperative in a few minutes", "Join your cooperative from your phone".
  - Home uses a `Panel` with `PageHeading` and one ink `ButtonLink` to `/sign-in`.
  - Privacy uses a `Panel` with `max-w-[65ch]`, `heading-5` section headings and `body-3` paragraphs.
  - Two-factor shows its QR or secret on a `Card tone="paper"` inside a step `Card`.
  - Replace every old utility (`text-muted`, `border-border`, `bg-surface`, `bg-bg`, `text-primary`, `bg-primary`, `text-fg`, `rounded-md`, `rounded-lg`) with the kit or the new tokens. Links in running text become `underline underline-offset-2 text-ink`.
- [ ] **Step 2:** Run `git grep -nE "border-border|bg-surface|text-muted|text-primary|bg-primary|text-fg|bg-bg|rounded-md|font-heading" -- src/app/page.tsx src/app/privacy src/app/\(auth\) src/app/join src/app/bank`. Expected: no output.
- [ ] **Step 3:** Run lint, typecheck and `npm test`, then commit with `feat(ui): restyle home, privacy, sign-in, sign-up, two-factor, join and bank confirm`.

### Task 6: Farmer screens

**Files:** Modify `src/app/farmer/page.tsx`, `bank-section.tsx`, `bank-form.tsx`, `leave-section.tsx`.

- [ ] **Step 1:** Replace `AuthCard` on `/farmer` with `<main id="main">`, then `PageHeading` (the cooperative name, or `t("title")`), then a status `Chip` beside it. Chip tones: ACTIVE forest, PENDING warn, LEFT and REMOVED step. Keep the existing `role="status"` paragraph text, in a `Card`. Put the profile `dl` in a `Card` (`dt` in `body-6 text-ink-soft`, `dd` in `title-3`). Put the bank and leave sections in `Card`s laid out on an 8/4 grid on md, stacked on phones. Leave is a `step`-tone button; its confirm stays inline.
- [ ] **Step 2:** Run the Task 5 grep on `src/app/farmer`. Expected: no output.
- [ ] **Step 3:** Run lint, typecheck and `npm test`, then commit with `feat(ui): restyle the farmer home`.

### Task 7: Officer screens

**Files:** Modify `src/app/officer/onboarding/{page,create-cooperative-form,edit-cooperative-form,bank-form,document-uploads}.tsx`, `src/app/officer/farmers/{page,farmers-panel}.tsx`, `src/app/officer/invites/{page,invites-panel}.tsx`.

- [ ] **Step 1: Onboarding.** Use `PageHeading` with the verification status `Chip` (VERIFIED forest, PENDING or SUBMITTED warn, REJECTED step with the reason shown under it). Each form (details, bank, documents) goes in its own step `Card` with a `heading-6` title. File inputs get `file:` utilities styled as step pills (`file:rounded-full file:bg-paper file:px-4 file:min-h-11 file:border-0`).
- [ ] **Step 2: Farmers.** Delete the local `primary` and `secondary` constants. Pending and active lists each go in a `Panel` with a `heading-5` heading and a count `Chip`. Each row is `Card tone="step"` with the name in `title-2` (`min-w-0 break-words`) and details in `body-6 text-ink-soft`. Approve uses `Button tone="ink"`; reject and remove use `tone="step"`. The reason form stays inline: a textarea with `Field`-style classes (`rounded-input bg-paper`), and confirm as `tone="ink"`.
- [ ] **Step 3: Invites.** Show the link in a read-only input (`rounded-input bg-step`) with a copy `Button tone="step"` beside it. Create uses `tone="ink" size="lg"`. Past invites become cards with a status `Chip`.
- [ ] **Step 4:** Run the Task 5 grep on `src/app/officer`. Expected: no output.
- [ ] **Step 5:** Run lint, typecheck and `npm test`, then commit with `feat(ui): restyle officer onboarding, farmers and invites`.

### Task 8: Admin screens

**Files:** Modify `src/app/admin/cooperatives/page.tsx`, `[id]/page.tsx`, `[id]/review-actions.tsx`.

- [ ] **Step 1:** The list is `PageHeading` plus a `Panel` of `Card` rows: name `title-2`, state and LGA `body-6 text-ink-soft`, status `Chip`, and a whole-card link with an `ArrowUpRight`, using `press press-lift`.
- [ ] **Step 2:** Detail uses `md:grid-cols-12`: details and documents in `md:col-span-8` `Card`s, review actions in a `md:col-span-4` `Card`. Approve is `tone="ink"`, reject `tone="step"`, and the reason field uses the `Field` style.
- [ ] **Step 3:** Run the Task 5 grep on `src/app/admin`. Expected: no output.
- [ ] **Step 4:** Run lint, typecheck and `npm test`, then commit with `feat(ui): restyle admin cooperative review`.

### Task 9: Sweep, visual check, full suite, PR

- [ ] **Step 1:** Run `git grep -nE "border-border|bg-surface|text-muted|text-primary|bg-primary|text-fg|bg-bg|rounded-(md|lg)\b|dark:|--color-(fg|surface|muted|primary|focus)" -- src`. Expected: no output. Fix any hits.
- [ ] **Step 2:** Add a `.claude/launch.json` entry if one is missing (`npx next dev -p 3200`; `.claude/` is untracked, so don't commit it). Open each screen with `preview_start` at 390×812 and 1280×800. Use seeded or e2e-created users from `tests/e2e/grant.ts` against the local `agrohub` dev DB, never staging. On each screen, confirm with `javascript_tool` that `document.documentElement.scrollWidth <= innerWidth`. At 390px, confirm that `read_network_requests` shows no `/photos/` request on `/sign-in`. Take one screenshot per role home for the PR.
- [ ] **Step 3:** Run `npm run lint && npm run typecheck && npm test`, then `npx playwright test` (integration tests not running). Expected: all pass. `auth.spec.ts:104` (TOTP enrol) is known to be flaky: if it fails on its own, rerun it once and report both runs.
- [ ] **Step 4:** Commit any fixes with `fix(ui): …`. Push with `git push -u origin redesign/app-ui`.
- [ ] **Step 5:** Open the PR against `main` with `gh pr create`. Title: "Redesign the app in the demo's visual system". The body summarises the changes, flags the spec's "choices made where the brief was silent", lists the verification, and includes the screenshots. No "Generated with" line.
