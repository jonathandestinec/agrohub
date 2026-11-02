# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: Nigerian farmer cooperatives. Farmers list their harvests and want to know exactly what they will earn; cooperative officers run the cooperative, approve farmers, screen lots and prices, answer buyer offers and mark deliveries. Both mostly use cheap Android phones on weak, expensive mobile data. When design choices conflict, farmers and officers come first.

Secondary: bulk buyers (processors, feed mills, traders) who browse lots, make offers and pay; AgroHub admins who verify cooperatives, handle disputes and must use two-factor sign-in; board admins who post weekly crop prices.

## Product Purpose

A phone-first web platform where verified farmer cooperatives sell their members' harvests to bulk buyers as one catalogue, track market prices and organise group input orders. Farmers on their own struggle to find buyers and negotiate prices; selling through the cooperative gets better prices with fewer middlemen. Success means every farmer sees what they will earn before agreeing, and is paid automatically once delivery is confirmed.

## Positioning

The buyer pays 100% upfront through AgroHub; the payment is held until delivery is confirmed and then split by bank transfer to the cooperative and to each farmer by their contribution. No cooperative or officer can hold or redirect the money. Fee terms are locked to a lot when it is approved.

## Operating Context

Officers share an invite link; farmers join by it and are approved by an officer. Farmers submit lots with a private lowest price that buyers never see. Officers approve, reject or counter lots, and accept offers at or above the floor alone; below it the farmer must agree. Stock is reserved about 15 minutes at checkout; offers expire after 48 hours; payment auto-releases 3 days after the officer marks delivery. Buyers deal only with the cooperative and never see phone numbers.

## Capabilities and Constraints

- Naira only; money is integer kobo, percentages integer basis points.
- Paystack for payments and payouts (recipient codes only; AgroHub never stores account numbers). Live payments await Paystack's answers.
- Nigeria Data Protection Act: consent at sign-up, privacy notice, deletion on request.
- English first; Pidgin, Hausa, Yoruba and Igbo only after native-speaker review.
- Non-goals at launch: direct farmer-buyer contact, auctions, lending, SMS/WhatsApp, live chat, native apps.
- Built so far: auth with 2FA for admins, cooperative sign-up and verification, invite links, farmer registration and approval. Lots, marketplace, payments and payouts are not built yet; `/demo` shows them with sample data.

## Brand Commitments

- Name: AgroHub. Tagline in use: "Sell together. Get paid with confidence."
- Never call the held payment "escrow" in the app, terms or pitch; say "payment held until delivery is confirmed".
- Voice: plain, calm, trustworthy. Short plain English for readers who may not be fluent; specific about money and dates; no hype.
- Brand identity is still to be supplied; the real app keeps a token slot for it (`src/styles/tokens.css`).

## Evidence on Hand

- Design spec and roadmap in `docs/superpowers/`.
- Photographs: eight openly licensed Wikimedia Commons photos of Nigerian farms and markets in `public/demo/` (credited in the demo footer), plus `public/trees-with-open-sky-in-the-center.png` supplied by the team.
- No real customers, testimonials, statistics, press or partner logos exist yet. All cooperatives, people and prices in `/demo` are sample data and must not be presented as real.

## Product Principles

- Show the farmer's money first: take-home before agreeing, held and paid amounts always visible.
- Nobody in between can touch the money; say so plainly wherever money moves.
- Private stays private: floor prices, phone numbers and bank details never reach the wrong person.
- Terms never change after a farmer agrees.
- Works on a cheap phone on a weak connection, or it does not ship.

## Accessibility & Inclusion

- Low-end Android phones and weak, costly data: small screens, compressed images, nothing that depends on a fast device; keep drafts if the connection drops.
- Low literacy: short words, labels with any icon, numbers and money shown large and unambiguous.
