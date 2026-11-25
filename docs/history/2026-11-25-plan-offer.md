# 2026-11-25: The plan they picked, the upgrade page, the confirm-email step

Plan: abstract-gliding-hellman. Branch `plan-offer` (from `growth-analytics` = `8587879`).
Bench: `~/Documents/Design Benches/royalty-plan-offer-2026-11-25/` (`mut.mjs`, `signed-out-check.mjs`, `shots/`).
Decisions kept at the default: D1 trial with no card (cancels at its end without one), D2 Stripe-hosted checkout.

## Shipped (times UTC)

- 18:23:53 / 18:23:56 / 18:23:57 edge functions `create-checkout-session` (v42, verify_jwt true),
  `stripe-webhook` (v35, verify_jwt false), `admin-growth-traffic` (v3), all `--use-api`.
- 18:24:58 frontend `ba67793` (+ server commit `7483a34`), live about 18:26.
- 18:30:54 `8c898bf`: the two new headings read as sentences (styles.css capitalizes every h1-h6);
  the login Resend box moved under the email field its copy points at. Live 18:31.

## What changed

- **Billing guards** (`_shared/checkout-rules.ts`, decided before Stripe is touched): one plan subscription per
  org; AppSumo lifetime orgs get Royalty Pro only; the 14-day trial only for an org that never subscribed;
  "view as" memberships refused; return URLs must point back at an allowed origin; Stripe's own error text
  never reaches the browser.
- **Webhook** (`_shared/stripe-webhook-rules.ts`): only the subscription the org runs on can downgrade it;
  the add-on has its own columns; a trial's $0 invoice no longer flips trialing → active; a late event for
  an ended subscription no longer writes its tier onto a Free org; invoices are matched by price.
- **Plan offer** (`app/plan-offer.js`): signup stores `user_metadata.plan_intent`; an eligible owner (free,
  published app, account under 30 days, never subscribed, not dismissed, not super admin or "view as") sees
  the picked plan's trial on the dashboard; Intelligence's Pro link points at it.
- **Upgrade page**: hosted checkout, names and success screen from PLAN_LIMITS (polls until the webhook
  lands), Free/Starter/Growth/Scale table tested against PLAN_LIMITS, portal for subscribed orgs, AppSumo
  sees only Royalty Pro, `?plan=` highlights a card. `plan-limits.js?v=3` on all 7 pages.
- **Confirm email** (`app/confirm-resend.js`): Resend on "Check your inbox", "Email not confirmed" and an
  expired or failed link (60 s cooldown); an existing email gets "already has an account"; the inbox screen
  is built with textContent; the hero path lands on the builder again.
- **Growth tab**: one row per landing page (`.html` stripped), the sign-up page counts its pageviews, no
  "vs previous period" while that period predates tracking.

## Found live

- 🔴 **`STRIPE_SECRET_KEY` in Supabase is an EXPIRED key** (`sk_live_rN…YUAz`): Stripe answers "Expired API
  Key provided". Every server-side Stripe call fails (checkout, portal, cancel, the webhook's subscription
  lookup). When it expired is not known; the 16:56 sign-up test never reached checkout. Until a new key is set, checkout answers
  "Checkout is unavailable right now" (it used to show Stripe's text with the masked key).
- Starter automations fail to seed when the dashboard auto-creates an app (`[Dashboard] Failed to seed
  automations`, dashboard.js `seedStarterAutomations`, older code): the test org got its app, 0 automations.
- Two checkouts opened in parallel can both complete; the second becomes the org's subscription and the
  first keeps billing unseen by the webhook (review finding, not fixed; rate-limited to 5/hour).

## Verification

- vitest 1532 → 1695, all green; check-i18n in sync; 6 new test files.
- Mutation check on both rules modules: 31/32 killed; the survivor is equivalent (`URL.toString()` keeps
  `{CHECKOUT_SESSION_ID}` unencoded too).
- Independent review (sonnet subagent): no billing-state, XSS or open-redirect defect; its 4 edge cases
  → 3 fixed (add-on invoices, stale updates, the upgrade page ignoring "view as" rows), 1 noted above.
- Live: checkout without a JWT → gateway 401; webhook boots (400 unsigned, 200 `received:false` bad
  signature); test org: Royalty Pro → 409 `royalty_pro_ltd_only`, Growth → 500 `checkout_unavailable`
  (expired key); the dashboard offer shows "You picked Growth … $39.99/mo"; Intelligence link rewritten;
  upgrade `?plan=growth` highlighted and stripped; signed out, an expired link shows "That link expired."
  + Resend; both HogQL queries run in PostHog (one `/pricing` row). Boot check with no console errors:
  upgrade, dashboard, intelligence, settings, apps, get-started, builder, signup, login (admin bounces the
  non-admin test account, as it should).

## Owed

- Jay: roll a new Stripe secret key and set `STRIPE_SECRET_KEY`; then the plan's live steps 3-5 (Stripe
  page shows Growth, 14 days, no card; success screen; cancel in the portal → Free, no offer again; 409 on
  Royalty), a Settings bundle purchase (embedded checkout: watch the console for a frame-src violation;
  the CSP frames only js.stripe.com).
- Jay (Stripe Dashboard): portal allows switching Starter/Growth/Scale; "remind before a trial ends" on.
- Jay (admin sign-in): mark "plan's Organization" internal; decide on "Test's Organization" and "Bhavye's
  Organization"; check the Growth tab and an existing-email sign-up; Resend on a real unconfirmed account.
