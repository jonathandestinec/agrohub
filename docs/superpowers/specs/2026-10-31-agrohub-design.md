# AgroHub: Design Document

Prepared for Destine. Status: approved by Destine on 31 October 2026; payment method pending Paystack's answers. Date: 31 October 2026.

## 1. Intent and why

AgroHub is a phone-first web platform where Nigerian farmer cooperatives sell harvests to bulk buyers, track market prices and organize group input orders. Farmers on their own struggle to find buyers and negotiate prices. A cooperative sells its members' produce as one catalog, so farmers earn better prices with fewer middlemen. This is a real product to be shipped to real cooperatives and farmers after the build, and it also satisfies the Tech4Youth Module 06 Group 6 brief: ten features, each paired with a non-code role.

## 2. Goals, non-goals, anti-goals

Goals

- Verified cooperatives sell members' harvests to buyers through one trusted, in-app process.
- Every farmer can see, before agreeing, exactly what they will earn.
- Money is held safely and paid out automatically, with no one able to skim or delay it.
- Works well on cheap phones and weak connections.
- Cooperatives sign up and run themselves; AgroHub only verifies them and handles disputes.

Non-goals for launch

- Direct contact between farmers and buyers.
- Auctions or competing bids.
- AgroHub lending money.
- SMS or WhatsApp notifications, live chat, a native mobile app.
- Part payments (the setting exists, the launch value is 100%).

Anti-goals (failures even if it technically works)

- A cooperative or officer able to hold or redirect money.
- A buyer learning a farmer's private lowest price.
- Phone numbers or personal data visible to other users.
- Terms changing after a farmer has agreed to them.
- An app that only works on fast phones and fast data.

## 3. Users and roles

One login per person. Roles are memberships attached to that login, with a role switcher, not a single field.

- Farmer: belongs to exactly one cooperative and logs in themselves.
- Officer: runs a cooperative; one or more per cooperative. Approves farmers, screens lots and prices, negotiates offers, marks deliveries. An officer cannot approve their own lots; another officer does, or an admin when there is none (for example a one-person cooperative). An officer belongs to one cooperative.
- Buyer: verified by email and phone only. Deals only with the cooperative, never the farmer.
- Admin: several allowed. Verifies cooperatives, handles reports and disputes, messages anyone. Two-factor authentication is mandatory.
- Board admin: updates the price board. Appointed by the owner admin. One person can be admin, board admin, or both.
- Owner admin: Destine. Appoints admins and board admins.

## 4. Constraints

- One Next.js app in one repo: TypeScript, Tailwind, Neon Postgres, Prisma, Better Auth, Resend, Paystack, Vercel.
- Naira only; money stored in kobo (whole numbers).
- The Nigeria Data Protection Act applies.
- The Paystack account is owned by Destine. Live payments need a verified Paystack business account.
- Phone-first and low-data. English is the default; Pidgin, Hausa, Yoruba and Igbo are switchable.
- Brand and visual identity will be supplied later; the build leaves a place for it.
- No deadline pressure; one builder (Destine) working with Claude Code.

## 5. Approaches considered

### 5.1 Build order (chosen: A)

- A. Foundation first, then features in dependency order. Schema and roles are right the first time and there is little rework. Slower to a first demo.
- B. One thin end-to-end slice first, then widen. Always demoable, but the schema gets reworked as features arrive.
- Chosen: A, because all ten features depend on roles and the data model.

### 5.2 Payment model (chosen: full payment held until delivery)

- Deposit now, balance on delivery. Leaves the cooperative exposed if the buyer refuses to pay the balance.
- Split at payment time (Paystack subaccounts). Fully automatic, but pays out before goods arrive, so refunds are painful.
- Chosen: the buyer pays 100% up front through AgroHub; AgroHub holds it; payouts happen after delivery is confirmed. This removes non-payment risk for cooperatives and protects buyers. The cost is that AgroHub holds money, which needs payout controls and a legal check before launch.

## 6. How it works

### 6.1 Cooperative onboarding and verification

- Self-serve sign-up. The officer submits the state registration certificate, by-laws and officer list.
- An admin reviews. Only verified cooperatives can list or sell. A one-person cooperative is allowed and goes through the same check.
- Documents are stored in a private bucket (S3-compatible, such as Cloudflare R2 or AWS S3) and opened only through short-lived signed links.
- The cooperative adds a bank account. AgroHub creates a Paystack transfer recipient and stores only its code, never the account number.
- Suspension: the cooperative's lots are hidden and new orders stop. Paid orders are completed or refunded by an admin. An admin can reinstate. Verification lapses when the registration certificate expires, so cooperatives re-submit it each year and admins are reminded.

### 6.2 Farmers join

- The officer creates a shareable invite link for the cooperative, which can be regenerated to cancel the old one. Officers can also invite directly.
- A farmer who opens the link registers with email and phone number, accepts consent, and adds a bank account (recipient code only). The officer approves before they can list anything. The farmer's profile holds farm size, crops grown and location (state and local government area).
- Email is the login. Phone is a contact detail visible only to admins. Phone confirmation is attempted; if unavailable the system falls back to email confirmation silently and records the phone as unconfirmed for admins.
- A farmer belongs to one cooperative. Leaving is blocked while any order on their lots is unfinished; their lots are unlisted first and their records are kept for accounting.

### 6.3 Lots and pricing

- A farmer submits a lot: crop, quantity, unit, grade, pickup location, photos, asking price, an optional note, and a private lowest price (the floor).
- Before submitting, the farmer sees the full breakdown: cooperative cut, AgroHub fee, take-home per unit.
- If the asking price differs a lot from the board price, the app shows a neutral warning only. The farmer may proceed with a note explaining why.
- The officer approves, rejects with a reason, or counters. The farmer accepts or declines a counter. Officers cannot approve their own lots.
- Only approved lots are visible to buyers, at the asking price. The floor is never shown to buyers, including in rejections.
- On approval the fee terms are locked to that lot. Later changes to the cut or fee apply only to new lots.
- The cooperative sells the combined catalog as its own. Each lot records which farmers contributed what quantity.

### 6.4 Price board

- Board admins enter weekly prices per crop and market. The board feeds the price warning and is visible to farmers and buyers.
- Crops and units (kg, bag, tonne, basket and so on) come from a list the board admin maintains.

### 6.5 Buyers, offers and messages

- Buyers browse lots, view the cooperative, and buy at the asking price or make an offer. This is not an auction.
- Offer at or above the floor: the officer can accept alone. Below it: the farmer must agree. Otherwise the officer rejects or counters with a message that never reveals the floor.
- In-app message threads (not live chat) tied to a lot or order: buyer and cooperative; farmer and officer; admin to anyone. No phone numbers are shared. Buyers never reach farmers.
- Rate limits on offers to stop spam. Buyers can search and filter lots by crop, location, grade, price and quantity.

### 6.6 Checkout and stock

- When a buyer starts paying, that quantity is reserved for about 15 minutes. If they pay it is confirmed; if not it is released.
- Other buyers see a soft notice that someone is checking out, and cannot pay for reserved stock.
- If two payments somehow both succeed, the later one is refunded automatically.

### 6.7 Payment, delivery and payout

1. The buyer pays 100% through Paystack. Our server marks the order paid only after Paystack's signed notification and a verification call, so a clone site cannot fake it.
2. Funds sit in AgroHub's Paystack balance. The cooperative arranges delivery or pickup.
3. The officer marks the order delivered; the buyer confirms receipt in the app.
4. On confirmation, AgroHub pays out the cooperative's share and each farmer's share by Paystack transfer, and keeps its own fee. Shares come from the terms locked on each lot, apportioned to farmers by their contributions.
5. If the buyer says nothing for three days after the officer marks delivery, funds release automatically. A 'report a problem' button freezes the funds for an admin to decide.
6. If nothing is marked delivered within 14 days of payment, the order goes to an admin.

- The payout method (transfers or manual settlement) depends on Paystack's answers and may change. Refunds before release use Paystack's refund function. Disputes after release are handled case by case by admins; who covers a loss after release is a business and legal question left open.

### 6.8 Disputes

- Admins decide, using the message thread, delivery marks and photos as evidence. Multiple admins share one queue. Every action is logged.

### 6.9 Farmer analytics

- Each farmer sees views, offers and sales for their own lots and how their price compares to the board. Counts only; buyer identities are never shown.

### 6.10 Group input orders, contributions and loans (decided: tracking only)

- Plan: the cooperative creates an input order (seed or fertilizer, price, deadline). Joining is voluntary per order: only farmers who need that input sign up, with their quantities. The cooperative can set a minimum total for the bulk price to apply. The officer tracks each member's share and contributions, and a simple loans tracker records small input loans.
- Decided: at launch these are tracking only. Buying the inputs and the money for them stay outside AgroHub, and AgroHub does not lend.
- Input payments through AgroHub are deferred until after launch.

### 6.11 Advice and alerts

- Season tips posted by admins, price-change alerts for crops a farmer follows, and order and delivery alerts. Email through Resend. Every key event emails the people involved: a new offer or counter, a lot approved or rejected, an order paid, a delivery date set, a delivery marked, a payout sent, a dispute opened or resolved, a verification result, and a bank detail change. Weather alerts later, once a data source is chosen. n8n is optional for scheduled alerts.

### 6.12 Public site

- Landing page, about, how to join, and SEO pages for buyers showing verified cooperatives and available lots. Making an offer needs a buyer account.

### 6.13 Ratings and reviews (my proposal)

- A buyer can rate a cooperative from 1 to 5 stars and add a short comment, once per completed order, within 30 days after confirming receipt. Only buyers with a completed order can review.
- Reviews show on the cooperative's public page as 'Verified buyer', with no buyer name. The average appears only once there are 3 reviews.
- The cooperative can reply once to each review. Users can report a review, and admins can remove abusive ones. Neither the cooperative nor its officers can delete a review.
- Reviews never affect payouts or order status. An order under dispute can be reviewed only after an admin resolves it.
- Farmers are not reviewed individually; their analytics show how their products perform.

### 6.14 Dashboards and delivery schedule

- Farmer home: my lots and their status, offers waiting on me, orders and earnings statements, analytics, messages.
- Officer home: farmers awaiting approval, lots awaiting screening, offers to answer, orders to prepare and deliver, input orders, and the delivery schedule.
- Buyer home: my orders and their status, my offers, receipts, messages.
- Admin home: cooperatives awaiting verification, disputes, reports, support messages, payout failures.
- Board admin home: price board entry and the crop and unit list.
- Delivery schedule: once an order is paid, the officer proposes a pickup or delivery date. The buyer sees it and can ask for another in the thread. The officer dashboard lists all upcoming deliveries by date.

## 7. Money rules

- All amounts in kobo. The AgroHub fee and the cooperative cut are percentages. Each cooperative sets its cut within a maximum set by admin. Buyers pay the lot price plus any delivery cost; the AgroHub fee and the cooperative cut come out of the sale price, not on top. Bank transfer is enabled as a payment channel, since bulk orders can exceed card limits; check Paystack's transaction limits.
- Paystack's processing fee is absorbed by AgroHub inside its fee, so a farmer's quoted take-home is never reduced.
- Every payout has a unique reference so it cannot be paid twice. Every payment, hold, release and refund is written to an append-only payout log.
- Payout instructions are created only by server code after a confirmed order. Admin 2FA, payout alerts, and daily reconciliation against Paystack.
- Paystack Transfers require OTP approval by default; automated payouts require turning that off after Paystack's requirements are met. Confirm limits and fees in Paystack's docs before building payouts.

## 8. Security and privacy

- Nigeria Data Protection Act: consent at sign-up, a privacy notice, and data deletion on request. Financial records are kept but stripped of personal details. Register with the data protection regulator when needed (later).
- Phone numbers are visible to admins only. Bank account numbers are never stored by AgroHub.
- Audit log of approvals, price changes, role changes and admin actions.
- Two-factor authentication is mandatory for every admin role. Rate limiting and input validation everywhere. Automated access tests prove that each role can reach only its own data and screens.
- Separate staging and live environments with separate keys. Backups with a tested restore.
- Generic terms of service for now; a lawyer drafts them before real users and real money. The terms must state that the cooperative is the seller and AgroHub is the platform.

## 9. Quality

- Phone-first screens, small pages, photos compressed on upload, drafts kept if the connection drops.
- Translations structured from day one; each language is enabled only after a native speaker reviews it.
- Brand and visual identity supplied later; design tokens live in one place so it can be applied without rework.

## 10. Build order (dependency order)

0. Foundation: repo, staging and live environments, schema, auth, memberships and role switcher, admin 2FA, audit log, translation scaffolding, brand token slot, email sending, scheduled-job runner.
1. Cooperatives, verification, private storage, invite links, farmer registration.
2. Crops, units and the price board.
3. Harvest lots and officer screening.
4. Marketplace, offers and message threads.
5. Checkout, stock reservation, payment hold, delivery confirmation, payouts, disputes.
6. Farmer analytics and dashboards, ratings and reviews.
7. Group input orders, contributions and loans tracker.
8. Advice and alerts.
9. Public site and SEO, security review, launch checklist.

Each step ends with something that runs, so there are working checkpoints.

## 11. Calls I made (please check)

- Each cooperative sets its own cut, up to an admin maximum.
- Auto-release after 3 days of buyer silence; 14-day delivery timeout; 15-minute stock reservation.
- Farmer shares are apportioned by contribution quantity.
- AgroHub absorbs Paystack processing fees.
- Input orders and loans are tracking only at launch (you agreed).
- Cloudflare R2 or AWS S3 for private documents.
- Browsing lots is public; offers need a buyer account.
- Weather alerts are deferred.

## 12. Open items

- Decided 3 November 2026: the AgroHub fee (3%) and the maximum cooperative cut (5%) are admin settings, stored in the `Setting` table and changeable later; a change applies only to lots submitted afterwards.
- Input payments through AgroHub: deferred past launch (section 6.10).
- Who covers a loss if a dispute is decided after payout (needs legal advice).
- Paystack, in writing: whether holding funds is allowed, whether manual settlement fits better, and the transfer limits, fees and OTP requirement. Accountant: tax on AgroHub's fees.
- Whether AgroHub holding buyers' money needs any licence or registration (lawyer).
- Brand and visual identity (coming from you).
- Which non-code role each teammate keeps; they feed content, wireframes, QA, the README and the pitch.

## 13. Final review: edge cases and defaults

Order edge cases (my proposals)

- Cancellation: a buyer can cancel for a full refund before the officer starts preparing the order. After that, cancelling needs the officer's agreement or an admin decision. A cooperative can cancel with a reason; the buyer is refunded in full and the cancellation is recorded against the cooperative.
- Shortfall: the officer enters the quantity actually delivered. If it is less than ordered, the buyer confirms or disputes it. The unmet part is refunded and each farmer's share shrinks in proportion.
- Offers and counters expire after 48 hours. An accepted offer reserves the stock for 24 hours for the buyer to pay.
- Lots carry an available-until date and hide themselves after it passes. Officers set a minimum order quantity per lot.
- Delivery: lot prices are at the pickup location. If the cooperative delivers, the officer quotes a delivery cost in the thread, it is added to the order before payment, and the cooperative keeps it. Confirmed.
- Every paid order produces a receipt for the buyer and an earnings statement for each farmer.

Money edge cases

- Cleared funds: buyer payments reach AgroHub's Paystack balance after a settlement delay, so payouts wait until the funds have cleared. A failed transfer (wrong account, low balance) stays in a payout-failed state, alerts an admin and is retried. It is never marked paid until Paystack confirms.
- Bank account names are checked against the registered name before a transfer recipient is created.
- Before building payments, ask Paystack in writing whether its terms allow a marketplace that holds funds and pays out afterward, and whether its manual (delayed) settlement is a better fit. Paystack is a payment processor, not an escrow provider, and the Central Bank of Nigeria regulates escrow services, so get a fintech lawyer's view and never describe the feature to users as escrow. Also get an accountant's view on tax on AgroHub's fees.
- Farmers without a bank account cannot be paid directly by Paystack transfer. See the open decision below.

Operations

- If a cooperative's only officer leaves or loses access, an admin can appoint a replacement after verifying with the cooperative. Officers are strongly encouraged to use two-factor authentication.
- The admin verification queue shows waiting time, and cooperatives get status emails so applicants are never left guessing.
- Money logic (fees, shares, reservations, payouts) gets automated tests that run before every deploy, using Paystack test mode. Error monitoring and alerts on payment failures from day one.

Decided: farmers without bank accounts

- Option A: require a bank account to list lots. Simple, and keeps farmers' money out of cooperatives' hands.
- Option B: an unbanked farmer's share goes to the cooperative's account for the officer to hand over, and the farmer confirms receipt in the app. This puts a farmer's money in the cooperative's hands, which goes against the principle that cooperatives never hold farmers' shares.
- Decided: Option A. The bank account is collected during onboarding, and a farmer without one cannot use AgroHub.

## 14. Flow walk-through additions

I walked every flow for each role (farmer, officer, buyer, admin, board admin) and for the background jobs. These gaps remained, each with a proposed default.

- Editing or withdrawing a live lot: a farmer can withdraw a lot that has no open orders. Changing the price or quantity of a live lot sends the change to the officer for approval, and the old version stays live until then. Open orders keep their locked terms.
- Changing bank details (farmer or cooperative): needs email confirmation, and officers need two-factor authentication. The change takes effect after 48 hours, admins are alerted, and payouts released during that wait go to the old account. This blocks a hijacked account from redirecting money.
- Changing a name (added 4 November 2026): nobody renames themselves, because payouts check the bank account's name against the registered name. A person, or an officer for a verified cooperative, asks with a reason and a supporting document (an affidavit, a marriage certificate or a gazette or newspaper notice; for a cooperative, the amended registration certificate). An admin who is not involved approves it, or rejects it with a reason. One request waits at a time; while it waits no bank change is allowed, and the existing payout account is never changed by a name change.
- Account safety: admins can suspend any account with a reason. A suspended account cannot trade, and its open orders go to an admin. Password reset and email change run through Better Auth with confirmation emails.
- Reports and support: any user can report a lot, a cooperative, a buyer or a message, and can message support (the admin queue) from inside the app.
- Scheduled jobs: auto-release, offer expiry, stock reservation release, lot expiry, delivery timeout, reconciliation and alerts run as scheduled jobs, for example Vercel Cron. Each job is safe to run twice.
- Demo and pitch: staging has seeded demo cooperatives, farmers, buyers and a price board, so the pitch to real cooperatives can run end to end without real money.
- Out of scope for launch: SMS and in-app payment for inputs.
