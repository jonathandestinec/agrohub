# App-wide redesign from the demo: design

Date: 2026-11-02. Branch: `redesign/app-ui` from `main`.

## Goal

Every real screen outside `/demo` (home, privacy, auth pages, join, bank confirm, farmer, officer, admin) uses the visual system stakeholders approved in the `/demo` presentation: its tokens, type and components. Source of truth: `DESIGN.md`, `PRODUCT.md`, and `src/app/demo/demo.css` and `src/app/demo/_components/` on branch `demo-screens`.

Done when every real screen uses the demo's tokens, type and components; `npm run lint`, `npm run typecheck`, `npm test` and the Playwright e2e suite pass; and a PR is open against `main`.

## Decisions (agreed with the user)

- Port the demo's component kit, not just the token values.
- Light only. The dark token set is removed and `color-scheme: light` is set.
- Photographs only on sign-in, sign-up and join, and only from `md` up. Phones never request them.

## Out of scope

- No behaviour, copy, route, service or schema changes. i18n message keys stay the same, apart from new keys for shell text such as the menu toggle label and photo credits.
- `/demo` itself (it is not on `main`), Phase 2 features, `src/lib/storage.ts` and `src/lib/action-result.ts`.
- New dependencies. Geist comes from `next/font/google`, which ships with Next.

## 1. Tokens (`src/styles/tokens.css`, `src/app/globals.css`)

`tokens.css` stays the single brand slot. It defines, on `:root`:

| Token | Value | DESIGN.md name |
|---|---|---|
| `--color-ground` | `#e9eae3` | frame-mist |
| `--color-paper` | `#ffffff` | paper |
| `--color-step` | `#f3f4ee` | field-step |
| `--color-step-deep` | `#e3e5dc` | field-step-deep |
| `--color-ink` | `#10140f` | soil-ink |
| `--color-ink-soft` | `#4a5148` | soil-ink-soft |
| `--color-lime` / `--color-lime-ink` | `#dcef6a` / `#1a2004` | harvest-lime |
| `--color-forest` / `--color-forest-ink` | `#173a2a` / `#f3f7ef` | cooperative-forest |
| `--color-good` / `--color-warn` / `--color-bad` | `#2f6b2c` / `#8a5a00` / `#a3341f` | status |
| `--color-warn-soft` | `#fbefd2` | waiting chip fill |

It also defines the radii (`--radius-input` 12px, `--radius-tile` 16px, `--radius-inner` 20px, `--radius-panel` 24px, `--radius-frame` 32px), `--ease` `cubic-bezier(0.22, 1, 0.36, 1)`, `--ease-out` `cubic-bezier(0.23, 1, 0.32, 1)`, and `--font-body: var(--font-geist), ui-sans-serif, system-ui, sans-serif`.

The old names (`bg`, `fg`, `surface`, `border`, `muted`, `primary`, `focus`) are removed outright, so any leftover use fails visibly in review. `globals.css` `@theme inline` exposes the new tokens as utilities (`bg-step`, `text-ink-soft`, `rounded-panel`, …). It also carries, unscoped:

- the demo's named text styles (`heading-1` to `heading-6`, `title-2` to `title-4`, `body-1`, `body-3`, `body-5`, `body-6`, `button-md`, `button-sm`, `caption-2`, `caption-4`) with their phone sizes;
- `.press`, `text-wrap: balance` on headings and `pretty` on paragraphs;
- tabular figures on `body`;
- the global focus ring: 2px ink, offset 2px;
- `prefers-reduced-motion`, which reduces transitions to opacity.

The body background is `ground`. Geist is loaded in `src/app/layout.tsx` with `variable: "--font-geist"`.

## 2. Shared kit (`src/components/ui/`)

Ported from the demo's `ui.tsx`, with `--d-*` references swapped for token utilities:

- `button.tsx`: `Button` and `ButtonLink`, tones `ink | lime | step | paper`, pill, `min-h-11`, `.press`, disabled at 50% opacity. A `size="lg"` option gives 48px for primary page actions. `Button` defaults to `type="button"`.
- `panel.tsx`: `Panel` (paper, 24px, 24/32px padding) and `Card` (step or paper fill, `rounded-inner`), for the panel-holding-cards pattern.
- `chip.tsx`: `Chip`, tones `step | lime | forest | warn`.
- `page-heading.tsx`: `PageHeading` (title, optional lead, optional actions slot).
- `icons.tsx`: `ArrowRight`, `ArrowUpRight`, `Check`, `Menu` (the morphing two-bar toggle).
- `clipped-photo.tsx`: `ClippedPhoto`, a photo panel with a top-left notch holding a small card, concave 24px corners in paper colour, and a bottom scrim. It uses `next/image` with `sizes` and lazy loading, inside a `hidden md:block` wrapper so phones don't fetch it.

`src/components/auth-ui.tsx` keeps its exports and props (`AuthCard`, `Field`, `SubmitButton`, `FormError`) so callers don't change:

- `AuthCard` renders a `Panel` and an optional `photo` prop. With a photo, it lays out 7/5 on `md+`: form left, `ClippedPhoto` right.
- `Field` gets a step fill (inputs sit on a paper panel, so they need the tone step), no border, `rounded-input`, `min-h-12`, and the label above in `title-4`. It gains an optional `error` prop: a 2px `bad` outline and an inline message, both ids joined in `aria-describedby`, plus `aria-invalid`.
- `SubmitButton` becomes an ink pill `Button`, full width, size `lg`.
- `FormError` becomes a `role="alert"` card with a `bad` left mark. It uses a tone step, not a border.

Other ad-hoc class strings in panels (for example `primary`/`secondary` in `farmers-panel.tsx`) are replaced with the kit's `Button` tones.

## 3. App shell (`src/app/layout.tsx`, `src/components/`)

- Body on `ground`. One centred frame: `max-w-[1360px]`, `p-2 md:p-4`, inner `rounded-frame bg-paper p-2 md:p-3`.
- The header row sits inside the frame. The "AgroHub" wordmark (`heading-6`) on the left links home. Pill nav links sit in the centre: `bg-step`, and the current page in `bg-ink text-paper` with `aria-current="page"`. On the right are the role switcher (pill select) and sign-out (step pill) or sign-in (ink pill).
- The current link needs the pathname, so the nav list becomes a small client component (`src/components/app-nav.tsx`). It receives the already-filtered links and labels from the server `NavSlot`. Access logic stays where it is.
- Below `md`, a 44px round `Menu` toggle opens a full-height paper panel (95% opacity, backdrop blur) holding the links, role switcher and account action. It has `aria-expanded`, `aria-controls`, closes on Escape and on navigation, and links arrive 60ms apart. Under reduced motion it only fades.
- A skip link goes to `#main`. Each page's `<main>` keeps its single `main` landmark: the shell wraps `children` in a `div`, not a second `main`.
- Footer inside the frame, as in the demo: a step panel (`mt-24`, `rounded-panel`) with one plain line about AgroHub, pill links (privacy notice; sign in when signed out), photo credits only on pages that use photos, and the large "AgroHub" wordmark (`text-[22vw] md:text-[17vw] xl:text-[15rem]`, `aria-hidden`). The credits are rendered by the page itself, under its photo panel, rather than by the global footer.

## 4. Screens

Each screen keeps its copy, structure and logic, and changes only presentation.

| Screen | Treatment |
|---|---|
| `/` home | `PageHeading` with welcome and intro; ink `ButtonLink` to sign in or the role home. |
| `/privacy` | Single `Panel`, body text capped near 65ch, headings `heading-5`. |
| sign-in, sign-up, join | `AuthCard` with `photo`: farmer-at-harvest for sign-in, cooperative for sign-up, maize for join. |
| two-factor, verified, bank confirm | `AuthCard` without photo; the TOTP QR sits on a paper card on a step panel. |
| `/farmer` | `PageHeading` with the cooperative name; status `Chip` (forest active, warn pending, step left/removed) plus the existing `role="status"` text; profile as a `dl` on a step card; bank and leave sections as cards. |
| officer onboarding | Stepped panels per form (details, bank, documents); verification status chip at the top. |
| officer farmers | Pending and active lists as step panels of paper cards; approve is ink, reject/remove step, confirm-with-reason inline. |
| officer invites | Invite link in a read-only field with a copy button (step); create is ink. |
| admin cooperatives list | Step panel of paper cards with a status chip and a link to the detail page. |
| admin cooperative detail | 8/4 grid: details and documents left, review actions card right. Stacks on phones. |

Money and dates keep their existing formatters (`src/lib/money.ts`). No numbers are reformatted here.

## 5. Photographs

Copy `public/demo/farmer-at-harvest.jpg`, `cooperative.jpg` and `maize.jpg` from `demo-screens` into `public/photos/`, with their Wikimedia credits (author, licence, URL) from the demo's `PHOTO_CREDITS` in `src/components/ui/photo-credits.ts`. Alt text describes the scene, and no chip or card sits over a face. The originals (380 to 570 KB) are committed as they are, because `next/image` serves resized WebP versions sized by `sizes`, so desktop downloads stay small and phones download nothing.

## 6. Testing

- Unit tests (`tests/unit/ui/*.test.ts`, node, `react-dom/server` `renderToStaticMarkup`), written first:
  - `Button` defaults `type="button"`; `disabled` is passed through.
  - `Field` with `hint` and `error` sets `aria-describedby` to both ids, plus `aria-invalid`.
  - `FormError` renders `role="alert"`, and nothing at all for `null`.
  - The `AppNav` current-link rule (a pure `isCurrent(pathname, href)` helper) is tested directly.
- E2E: the existing suites must pass unchanged. One assertion is added: after sign-in the current nav link has `aria-current="page"`.
- Visual check: each screen at 390px and 1280px in the browser pane, with no horizontal scroll and nothing older than the new tokens left. A final `git grep` finds no `border-border`, `bg-surface`, `text-muted`, `text-primary`, `bg-primary`, `rounded-md` or `dark:` in `src/` outside `/demo`.
- Before each commit: `npm run lint`, `npm run typecheck`, `npm test`. Playwright runs at the end, and never at the same time as integration tests (shared DB).

## Choices made where the brief was silent

- Inputs use a step fill on paper panels (DESIGN.md shows paper inputs on step panels; auth forms sit on paper).
- The old token names are removed rather than aliased, so missed screens show up.
- The demo's wordmark footer is carried over (the user's call, 2026-11-02).
- New message keys get `""` in `ha`, `ig`, `pcm` and `yo`, matching the existing untranslated keys, so the key-parity test passes.
