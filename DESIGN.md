---
name: AgroHub
description: Sell together. Get paid with confidence.
colors:
  frame-mist: "#e9eae3"
  paper: "#ffffff"
  field-step: "#f3f4ee"
  field-step-deep: "#e3e5dc"
  soil-ink: "#10140f"
  soil-ink-soft: "#4a5148"
  harvest-lime: "#dcef6a"
  harvest-lime-ink: "#1a2004"
  cooperative-forest: "#173a2a"
  cooperative-forest-ink: "#f3f7ef"
  growth-green: "#2f6b2c"
  caution-amber: "#8a5a00"
  alert-clay: "#a3341f"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.035em"
  display-sm:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.11
    letterSpacing: "-0.025em"
  headline-sm:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  subhead:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "-0.015em"
  subhead-sm:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
  title-lg:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.56
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  wordmark:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.06em"
rounded:
  input: "12px"
  tile: "16px"
  inner-panel: "20px"
  panel: "24px"
  frame: "32px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  section: "128px"
  section-lg: "192px"
components:
  button-primary:
    backgroundColor: "{colors.soil-ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
    height: "44px"
  button-lime:
    backgroundColor: "{colors.harvest-lime}"
    textColor: "{colors.harvest-lime-ink}"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
    height: "44px"
  button-step:
    backgroundColor: "{colors.field-step}"
    textColor: "{colors.soil-ink}"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
    height: "44px"
  nav-link:
    backgroundColor: "{colors.field-step}"
    textColor: "{colors.soil-ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  nav-link-current:
    backgroundColor: "{colors.soil-ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
  chip:
    backgroundColor: "{colors.field-step}"
    textColor: "{colors.soil-ink-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.soil-ink}"
    rounded: "{rounded.input}"
    padding: "0 16px"
    height: "48px"
  card:
    backgroundColor: "{colors.field-step}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

# Design System: AgroHub

Scope: this records the `/demo` visual world (`src/app/demo/demo.css` and `src/app/demo/_components`). The signed-in app still uses the neutral placeholder tokens in `src/styles/tokens.css`, which is the slot where the final brand identity will land.

## Overview

**Creative North Star: "The Market Day Ledger"**

A well-kept cooperative ledger opened on a bright market morning. Money is written large and plainly, real photographs of Nigerian farms and markets carry the warmth, and everything else steps back. Pages sit inside one white rounded frame on a pale mist ground; inside it, panels are separated by small steps in tone rather than lines or shadows.

Density is comfortable on desktop and thumb-first on a phone: every control is at least 44px, pills and generous panels make the page easy to hit with a thumb on a cheap Android screen. One sans-serif face does all the work in two or three sizes per screen. Colour is restrained: the harvest lime marks the action and the "held until delivery" promise; the cooperative forest marks trust, verification and money already paid.

The signature is the clipped photograph: a photo panel with notches cut from its corners, where small cards sit in the cut-outs and the frame's white flows into the gap with concave corners.

**Key Characteristics:**
- One white rounded frame (32px) on a mist ground; panels inside at 24px.
- Tone steps, not borders or shadows, separate surfaces.
- Real, credited photographs of farms and markets; a dark scrim under any text on a photo.
- Lime for the action and the held-payment promise; forest for verified and paid.
- Pill buttons, 44px minimum targets, press feedback on everything.
- Numbers in tabular figures and stated in full naira (₦64,850.00).

## Colors

A pale field palette with one bright harvest accent and one deep forest anchor.

### Primary
- **Harvest Lime** (harvest-lime): the hero panel, the primary marketing action, the "Payment held until delivery" chip, current-step highlights and the selected state of picker tiles. Always paired with Harvest Lime Ink text.
- **Cooperative Forest** (cooperative-forest): verified badges, money already paid, completed steps, the closing call to action and the onboarding progress bar. Text on it uses Cooperative Forest Ink.

### Neutral
- **Frame Mist** (frame-mist): the page ground behind the white frame.
- **Paper** (paper): the frame itself, inputs, and inner cards on a stepped panel.
- **Field Step** (field-step) and **Field Step Deep** (field-step-deep): panel surfaces and their hover state.
- **Soil Ink** (soil-ink): all running text and the default dark button.
- **Soil Ink Soft** (soil-ink-soft): secondary notes, hints and metadata only.

### Status
- **Growth Green** (growth-green): price up, checks, success confirmations.
- **Caution Amber** (caution-amber): waiting states and prices far from the board.
- **Alert Clay** (alert-clay): field errors and price down.

### Named Rules
**The Two Voices Rule.** Lime speaks for the action and the held-payment promise; forest speaks for trust and money already paid. Never swap them and never add a third accent.

**The Ink Not Grey Rule.** Running text is in Soil Ink. Soil Ink Soft is for notes beside the text, never for the text itself.

## Typography

**Display Font:** Geist (with ui-sans-serif, system-ui)
**Body Font:** Geist
**Label/Mono Font:** none; tabular figures on the same face for numbers.

**Character:** A plain, modern grotesque that reads clearly at small sizes on a low-resolution phone, set tight and heavy only at display sizes.

### Hierarchy
- **Display** (600, 60px desktop / 36px phone, 1.0, -0.035em): the hero line and the lot name on a lot photo.
- **Headline** (600, 36px desktop / 24px phone, 40px, -0.025em): page titles and section headings.
- **Title** (500, 14 to 20px): card titles, list items, labels that lead a block, nav items.
- **Body** (400, 16px, 24px): running text, capped near 60 to 65 characters.
- **Label** (500, 12px, 16px): chips, captions, timestamps. Sentence case, never tracked uppercase.

### Named Rules
**The Say It In Two Lines Rule.** Headlines fit in two lines at every width; cut words before shrinking type.

**The Full Naira Rule.** Money is always written in full with the naira sign and kobo (₦64,850.00) in tabular figures, never abbreviated (no "64.8k").

## Layout

One centred frame up to 1360px wide with an 8px (phone) or 16px (desktop) margin and 8 to 12px inner padding. Inside, a 12-column grid on desktop: heroes split 7/5, app screens 8/4 or 7/5, and every grid collapses to a single column on a phone. Gaps between sibling panels are small (8 to 12px) so the frame reads as one sheet; gaps between landing sections are large (128px phone, 192px desktop). Section headings sit at the left with a short supporting line on the right on wide screens. Phone checks are done at 390px with no horizontal scroll.

## Elevation & Depth

Flat by default. Depth comes from tonal steps: mist ground, white frame, stepped panel, white inner card. There are no shadows on surfaces at rest. Blur appears only where something truly floats over content: the price chip on a hero photo and the full-height mobile menu.

### Named Rules
**The Tone Step Rule.** If two surfaces need separating, step the tone. Do not reach for a border or a shadow.

## Shapes

Generous, nested rounding: frame 32px, panel 24px, inner panel 20px, tile 16px, input 12px, and pills (9999px) for every button, chip and nav item. Nested radii shrink by the gap between them. Media follows its container's radius. The clipped photograph cuts square notches from a photo's corners and fills the joins with 24px concave curves in the frame colour.

## Components

### Buttons
- **Shape:** fully rounded pill (9999px), minimum height 44px; 48px for primary page actions.
- **Primary:** Soil Ink with white text, 8px by 20px padding; the hero version carries a lime circle holding an arrow at its right end.
- **Lime / Step / Paper:** Harvest Lime for the marketing action, Field Step or Paper for secondary actions.
- **States:** press scales to 0.97 in 160ms; hover darkens the fill in 240ms on a strong ease-out; focus shows a 2px Soil Ink outline offset by 2px; disabled drops to half opacity.

### Chips
- **Style:** pill, 12px medium text; tones are Field Step (neutral), Harvest Lime (held / live), Cooperative Forest (verified / paid) and a pale amber (waiting).
- **State:** filter pills switch to Soil Ink with white text when pressed, with `aria-pressed`.

### Cards / Containers
- **Corner Style:** 24px panels; 20px inner cards; 16px tiles.
- **Background:** Field Step panels holding Paper cards, or Paper cards on the frame.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Internal Padding:** 24px phone, 32px desktop.

### Inputs / Fields
- **Style:** Paper fill, no stroke, 12px radius, 48px tall, label above in medium 14px.
- **Focus:** 2px Soil Ink outline, offset 2px.
- **Error:** 2px Alert Clay outline plus a specific inline message under the field, linked with `aria-describedby`.

### Navigation
- **Style:** wordmark at left, pill links in the centre (Field Step; current page in Soil Ink), one lime action at right.
- **Mobile:** a 44px round toggle whose two bars morph into a cross; a full-height paper panel at 95% opacity with strong blur; links arrive 60ms apart, rising 24px.

### Clipped Photograph (signature)
A full-bleed photo in a 24px panel with a notch cut from the top-left (holding a small status card) and, on the hero, from the bottom-right (holding one supporting sentence). The notch is frame-coloured and joined to the photo by 24px concave corners. Floating chips sit only over empty parts of the photo, never over faces.

## Do's and Don'ts

### Do:
- **Do** use real, credited photographs of farms and markets, with a dark bottom scrim (black 65% to transparent) under any text on them.
- **Do** keep every tap target at least 44px and give every pressable thing a 0.97 press.
- **Do** animate only transform and opacity on `cubic-bezier(0.22, 1, 0.36, 1)`, 500 to 900ms for entrances, under 300ms for responses, with a plain fade under reduced motion.
- **Do** show what a farmer takes home before any action that commits them.

### Don't:
- **Don't** call the held payment "escrow"; say "payment held until delivery is confirmed".
- **Don't** put a border or a shadow on a surface at rest.
- **Don't** use background gradients; the photo scrim is the only one.
- **Don't** set running text in Soil Ink Soft or in tracked uppercase.
- **Don't** place a chip or card over a person's face in a photograph, or tie a pictured real person to a sample cooperative.
- **Don't** invent customers, testimonials, statistics or partner logos.
