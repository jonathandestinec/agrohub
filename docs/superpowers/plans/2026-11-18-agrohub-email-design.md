# AgroHub Email Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every email AgroHub sends gets one branded, email-client-safe design: a header with the AgroHub mark, brand colours and type, a clear button, a footer, a plain-text alternative, and a photo hero on the welcoming emails.

**Architecture:** A new pure module `src/modules/notifications/email-layout.ts` exports `renderEmail({ preheader, bodyHtml, action?, hero?, fallbackLink? })` → `{ html, text }`. Every template in `src/modules/notifications/emails.ts` (and the verification email, moved out of `src/lib/auth.ts`) builds its existing body copy as before, then calls `renderEmail`. `EmailMessage` gains an optional `text` that goes to Resend and the fake outbox. Static images live in `public/email/` and are referenced by absolute URL from `env.BETTER_AUTH_URL`. A small script makes the images once with Playwright (already a dev dependency); the outputs are committed.

**Tech Stack:** TypeScript, Vitest, Playwright (image generation and screenshots), Resend. No new dependency, no migration.

**Base:** branch `email-design`, cut from `main` after the PR #26 merge, in a new worktree `C:\Users\jonat\Dev\agrohub-branches\agrohub-email-design`. This plan is the branch's first commit.

**Spec:** `docs/superpowers/specs/2026-10-31-agrohub-design.md` (brand and email sections); `DESIGN.md` and `src/styles/tokens.css` for the brand; design system artifact https://claude.ai/artifact/SuQN9V48T1w3jrFMH4pxFb (synced to the app 2026-11-16).

## Global Constraints

- Templates keep their copy and their escaping. Only the wrapper changes, and the main link in a sentence becomes the button (with the same label).
- **The first `href="` in every email is the action link.** Five e2e helpers (`auth.spec.ts`, `journey.ts`, `nav.spec.ts`, `price-board.spec.ts`, `password-reset.spec.ts`) and `tests/integration/auth.test.ts` read the first href; `auth-reset.test.ts:99` reads the first `reset-password/`. So the header mark is not a link, no `<link href>` font tag (Geist is named in the font stack only), and every other link (fallback URL, footer) comes after the button. A unit test locks this in.
- Layout markup, CSS, alt text, preheader and footer contain none of: `escrow`, `floor`, `phone`, `bank account`, `undefined`, `<b>`, `<i>`, `<script`. Existing tests assert on these.
- Never log addresses, links or html. No new log lines.
- No file outside `public/email/` under `public/`, and nothing under `src/app/` (the `og-favicon` branch owns favicon/OG files there).
- Test first, commit per task, `npm run lint`, `npm run typecheck`, `npm test` before each commit. Searches go to `search`/`grep`, test runs to `test`, the final diff check to `audit`.

## Review outcome (orchestrator, 2026-11-18)

Approved. Decisions 1-5 confirmed as written; decision 7 and the two added buttons in Task 3 are flagged in the PR. Changes:
- **Mark:** use the favicon variant from `og-favicon` (not the app `Mark`, whose leaves are too small at 40px). Lime disc `#dcef6a`, forest leaves `#173a2a`, the two leaf paths wrapped in `<g transform="translate(16 16) scale(1.6) translate(-16 -12)">`. The SVG markup is copied into `scripts/email-images.ts`; nothing is imported from `src/app/`.
- **Plain text:** no preheader in `text`; `htmlToText` must never output the hidden preheader (tested).
- **`escapeHtml`:** remove the duplicate in `src/lib/auth.ts` when the verification email moves.
- **Screenshots:** 8, not 16, each PNG under about 150 KB. The four emails at 375 light; verification and password reset at 1280 light; verification and the alert email at 375 dark.

## Design decisions (spec silent; repeated in the PR description)

1. **Hero format: JPEG, not PNG.** The brief says PNG (because Gmail drops SVG) and "small files". A photo can't be both: a 1200×480 photo PNG is roughly 1 MB, the same as a JPEG at about 80 KB. Gmail, Outlook and Apple Mail all show JPEG. So: the **mark is PNG** (flat colours, transparent, about 3 KB at 2×), and the **hero is JPEG** (target ≤ 90 KB). No SVG anywhere. *Orchestrator: confirm, or say PNG for the hero too (I'd then use a flat graphic, not a photo).*
2. **Hero photo: `public/photos/cooperative.jpg`** ("Members of a farmer cooperative seated together at a meeting", USAID in Africa, **public domain**), so no credit line is required. A small credit still goes in the footer of hero emails, matching the site's credits page. Not `farmer-at-harvest.jpg` or `maize.jpg`, which are CC BY-SA 4.0 and would need a credit in every email.
3. **Which emails get the hero:** the welcoming ones only: email verification (welcome), farmer invite, cooperative verified, cooperative reinstated, farmer approved. Everything else gets the header mark only: password reset, bank change confirm and admin alert, rejections/suspension/removal, certificate emails and digest, admin payout alerts, and all 16 event alert emails. Security and money emails stay quick to read, and a cheerful photo above "your cooperative is suspended" reads wrong.
4. **Look (light, the inline default):** outer background ground `#e9eae3`; card paper `#ffffff`, 24px radius (panel), 600px wide; header row with the mark (40×40 shown, 80×80 file) and the live-text wordmark "AgroHub" in ink `#10140f`, 20px, 600 weight, -0.02em; body text ink 16px/24px, secondary ink-soft `#4a5148`; button ink `#10140f` pill with white 16px/600 text, 44px tall, padding 12px 24px (the app's default `Button` tone); fallback link and footer 13px ink-soft; footer on the ground, outside the card. A thin lime `#dcef6a` rule (4px) at the top of the card as the brand accent. Font stack: `Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` (Geist only shows where it is installed; nothing is loaded).
5. **Dark mode is new brand work: kept minimal.** `tokens.css` is light-only. Apple Mail and iOS Mail honour `prefers-color-scheme`; for those, a small `<style>` block (plus `<meta name="color-scheme" content="light dark">` and `supported-color-schemes`) sets ground `#10140f`, card `#1b211a`, text forest-ink `#f3f7ef`, secondary `#b9c0b6`, and the button to lime `#dcef6a` with lime-ink `#1a2004` text (an ink button would vanish on a dark card). Gmail apps and Outlook ignore the media query and invert colours themselves; the inline design is built to survive that: the mark is a transparent PNG whose lime disc reads on light and dark, no text is baked into an image, and no colour pair depends on a background image. *Orchestrator: confirm the dark values or say "no dark styles".*
6. **Outlook:** the button is a table cell with `bgcolor` and padding on the `<td>` and the `<a>` set to `display:inline-block` (a "bulletproof" button). Outlook on Windows shows square corners; that is accepted, not worked around with VML. The container table has `width="600"` plus `max-width:600px`; on screens under 620px a media query makes it 100% with 20px side padding.
7. **Fallback link on credential emails.** Verification, password reset, farmer invite and bank change confirm add one line after the button: "If the button does not work, copy this link into your browser:" and the escaped URL as a link. This adds copy, after the action href so the tests above still read the right link. Alert and status emails don't get it. *Flag in PR.*
8. **Preheader:** each email has a hidden preview line (inbox snippet), taken from its first sentence. For alert emails it is the alert sentence; for templates a fixed short line per template (listed in Task 3). Hidden with the usual `display:none;max-height:0;overflow:hidden;mso-hide:all`.
9. **Plain text:** `renderEmail` returns `text` built from the same body: tags stripped, `<br>`/`</p>`/`</li>` to line breaks, entities decoded, the action as `Label: URL`, and the footer. `EmailMessage.text` is optional; `sendEmailWith` passes it to Resend and stores it in the fake outbox. `payoutAlertEmail` keeps its own hand-written `text`.
10. **Images by absolute URL from `BETTER_AUTH_URL`** (trailing slash trimmed), e.g. `https://agro-hub.com.ng/email/mark@2x.png`. On staging and previews the images load from that deployment. **Risk:** if Vercel Deployment Protection is on for a preview, Gmail's image proxy gets a 401 and the email shows the alt text. The email still reads fine because every image has alt text and nothing depends on it. Production is unaffected. Stated in the PR; no setting is changed.
11. **Images made by a script, committed:** `scripts/email-images.ts` (run with `tsx`, which is already a dev dependency) launches Playwright Chromium and screenshots (a) the `Mark` SVG at 80×80 with a transparent background to `public/email/mark@2x.png`, and (b) `public/photos/cooperative.jpg`, cropped with `object-fit: cover` to 1200×480 as JPEG quality 72, to `public/email/hero-cooperative.jpg`. It isn't run in CI. `docs/architecture.md` gets no dependency line (none added), but a sentence about the script goes under Decisions.
12. **The proxy must let `/email/*` through without a session.** Task 1 checks the `proxy.ts`/middleware matcher (through the `search` subagent) and a dev-server request returns 200 with no cookie. If it doesn't, the matcher gets `email/` added (one-line change, tested).

## Files

- Create: `src/modules/notifications/email-layout.ts`, `tests/unit/email-layout.test.ts`, `scripts/email-images.ts`, `scripts/email-previews.ts`, `public/email/mark@2x.png`, `public/email/hero-cooperative.jpg`
- Modify: `src/modules/notifications/emails.ts` (every template; adds `verificationEmail`), `src/lib/auth.ts` (uses `verificationEmail`), `src/lib/email.ts` (`text`), `src/app/api/dev/outbox/route.ts` only if it whitelists fields (check first), callers that drop `text`: `src/modules/cooperatives/service.ts:505`, `src/modules/cooperatives/invites.ts:192`, `src/modules/banking/service.ts:250,325`, `src/modules/farmers/service.ts:303`, `src/modules/payments/alerts.ts:32,39` (spread the template result instead of picking `{ subject, html }`), `tests/unit/emails.test.ts`, `tests/unit/email.test.ts`, `tests/unit/alert-emails.test.ts`, `docs/architecture.md` (one sentence)
- Not touched: anything in `src/app/` except the dev outbox route if needed, `public/` outside `public/email/`

## Tasks

### Task 1: Base, plan commit, image route check
- [ ] Confirm the PR #26 merge is on `origin/main` (`git log origin/main`). Create the worktree and branch `email-design` from `origin/main`. `npm install` if needed.
- [ ] Commit this plan to `docs/superpowers/plans/2026-11-18-agrohub-email-design.md`.
- [ ] `search` subagent: the proxy/middleware matcher and whether `/email/*` static files need a session; whether `src/app/api/dev/outbox/route.ts` returns whole messages or picks fields.
- [ ] If the matcher would gate `/email/*`, write the failing test for the matcher, fix, commit.

### Task 2: The layout (`renderEmail`)
- [ ] Write `tests/unit/email-layout.test.ts` first, failing:
  - wraps `bodyHtml` inside the layout: has `<!doctype html>`, `lang="en"`, the `color-scheme` meta, a `role="presentation"` table with `width="600"`, the wordmark text "AgroHub", and the body;
  - the mark `<img>` has `src="${BETTER_AUTH_URL}/email/mark@2x.png"` (absolute, https or http), `width="40" height="40"`, and non-empty `alt="AgroHub"`; every `<img>` in the output has a non-empty `alt` and an absolute `src`;
  - with `action`, the button's href is the **first** `href="` in the html; the label and href are escaped;
  - with `hero: "cooperative"`, a hero `<img>` with absolute src, width 600, and alt text describing the photo; without it, no hero;
  - with `fallbackLink`, the URL appears as a link after the button;
  - `text` contains the body sentences without tags, decoded entities, `Label: URL` for the action, and no `<`;
  - the output (html and text) contains none of the banned strings listed in Global Constraints;
  - no `<link`, no `<script`, no `.svg`.
- [ ] Run via `test` subagent, watch it fail.
- [ ] Implement `email-layout.ts`: escape helper (moved from `emails.ts` and exported, so there's one `escapeHtml`), `emailAssetUrl(path)` from `env.BETTER_AUTH_URL`, `renderEmail`, `htmlToText`. Inline styles on every element; the `<style>` block holds only the dark-mode and under-620px rules.
- [ ] `test` subagent green → lint, typecheck, test → commit `feat: one branded layout for every email`.

### Task 3: Apply the layout to every template, and move the verification email
- [ ] Extend `tests/unit/emails.test.ts` first, failing: a table of every template (status ×4, invite, bank confirm, bank admin alert, farmer status ×3, certificate expired, reminder, digest, payout alert ×6, password reset, the new `verificationEmail`) asserting each html contains the layout marker (the wordmark and the mark img), keeps its key sentence, never says escrow, has a `text`; templates with an action have that action as the first href; the hero is on exactly the five emails in decision 3. `alertEmail` likewise in `tests/unit/alert-emails.test.ts` (first href = the absolute page link; the "held until delivery is confirmed" and escaping tests stay as they are).
- [ ] `test` subagent: fails.
- [ ] Rewrite each template to build its existing body copy and call `renderEmail`. Preheaders (one per template): e.g. reset "Choose a new password for AgroHub. The link works for one hour."; invite "{coop} has invited you to sell with them on AgroHub."; verification "Verify your email to finish signing up for AgroHub." Cooperative/farmer-status bodies keep their sentences; where the old copy said "Sign in…", the button is "Sign in to AgroHub" → `${BETTER_AUTH_URL}/sign-in`. (*Flag: the status emails had no link before; adding a sign-in button is new.*) Admin emails (bank admin alert, digest, payout alerts) get a button to the admin page they already name (`/admin/orders` for payout alerts, `/admin/cooperatives` for the digest, `/admin` for the bank alert), each checked to exist via `grep` subagent first.
- [ ] Move the verification html from `src/lib/auth.ts:79` to `verificationEmail({ link })` in `emails.ts`; `auth.ts` calls it. Existing `auth.test.ts` href checks must stay green.
- [ ] `test` subagent: unit green → lint, typecheck, test → commit `feat: branded layout on every template, verification email moved to emails.ts`.

### Task 4: Plain-text alternative end to end
- [ ] Failing tests in `tests/unit/email.test.ts`: `sendEmailWith` passes `text` to Resend when given and omits it when not; the fake outbox stores `text`.
- [ ] Implement in `src/lib/email.ts`. Change the six caller sites that pick `{ subject, html }` to pass the whole template result (`...mail`), so `text` reaches Resend. Integration tests in those modules stay green.
- [ ] `test` subagent: full Vitest (unit + integration) green → lint, typecheck → commit `feat: send a plain-text alternative with every email`.

### Task 5: Images
- [ ] Write `scripts/email-images.ts` (Playwright Chromium, as in decision 11). Run it once; check sizes (mark ≤ 6 KB, hero ≤ 90 KB) and view both files.
- [ ] Unit test (failing first): `public/email/mark@2x.png` and `public/email/hero-cooperative.jpg` exist, are under those sizes, and every image path `email-layout.ts` references exists in `public/email/`.
- [ ] Add one sentence to `docs/architecture.md` §11 Decisions (no dependency added; images made by the script with Playwright).
- [ ] `test` subagent green → lint, typecheck, test → commit `feat: email mark and hero images`.

### Task 6: Visual check and screenshots
- [ ] `scripts/email-previews.ts` (tsx): renders every template with sample data (including a hostile name like `A & B <Farmers>`) to `email-previews/*.html` plus an `index.html`, with `BETTER_AUTH_URL=http://localhost:3000`. `email-previews/` is git-ignored except a `README` (the html isn't committed).
- [ ] Start the dev server (`preview_start` via `.claude/launch.json`), confirm `GET /email/mark@2x.png` is 200 with no cookie, and serve the previews over http (copy them to a scratch static server on another port; `file://` renders light only in the browser pane).
- [ ] In the built-in browser, check each template at desktop and 375px, light and dark: no horizontal scroll at 375px, button visible and tappable, images load, dark text readable.
- [ ] For files to attach to the PR (the pane's screenshot has no save path): a Playwright script captures the same pages to `docs/email-screenshots/` (PNG, `page.emulateMedia({ colorScheme })`, viewports 1280 and 375) for four representative emails (verification with hero, password reset with fallback link, an alert email, an admin payout alert), 16 images. These are committed so the PR body can link them. *Flag: that's ~16 small PNGs in the repo; the alternative is uploading them to the PR by hand.*
- [ ] The PR states that the browser's dark emulation checks only the `prefers-color-scheme` path (Apple Mail); Gmail and Outlook dark inversion are not reproduced, and the user should send a real test email to Gmail and Outlook from staging.
- [ ] Commit `docs: email screenshots and preview script`.

### Task 7: Audit, push, PR
- [ ] `test` subagent: lint, typecheck, Vitest, Playwright e2e (the five href-reading specs especially).
- [ ] `audit` subagent on the committed branch diff against `CLAUDE.md`.
- [ ] Push `email-design`; open a PR against `main` with: summary, the decisions above (flagged), screenshots, the staging/preview image-protection risk, and the subagent log (which subagent ran each search and test, and which were done without one). Don't merge.

## Subagent log so far (for the PR)

- `search` (Haiku): Mark source, landing images, `public/` contents, fonts, colour tokens, Button styling. *(It reported running Glob/Grep/Read itself, not nesting further.)*
- `grep` (Haiku): every call site of `sendEmail` and each template, `fakeOutbox` uses, tests asserting on email html/href.
- **Done without a subagent** (main session, Bash): `ls .claude/agents`; `git log origin/main`; `git worktree list`; reading named files on the PR #26 branch (`src/lib/email.ts`, `emails.ts`, `alert-emails.ts`, `tokens.css`, `globals.css`, `DESIGN.md`, `docs/architecture.md`, the resend plan, the email unit tests, `auth.ts` lines 45-95, the href-reading test lines); `ls -la public/photos`; one `grep` of `package.json`/`node_modules` for image tooling and one of `photo-credits` for `PHOTOS`. These last two count as searches done without a subagent.
