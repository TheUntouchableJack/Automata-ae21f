# 2026-11-25: Growth tab in Super Admin

Plan: can-we-enhance-our-breezy-flute. Branch `growth-analytics` (from `owner-journey` = `9430b71`).

## Shipped (times UTC)

- 12:32:44 migration `20261125000001_admin_growth_metrics.sql` (`20260725000001` quarantined and restored).
  The backfill marked 2 orgs internal.
- 12:32:58 edge function `admin-growth-traffic` (v1, `--use-api`, verify_jwt = false).
- 12:34:08 frontend `390668a` + `5c5565d` (pretty-URL fix), live about 12:35.
- 13:15:07 `a24eea6`: `.app-main { min-width: 0 }` on admin.html, so wide tables scroll inside their boxes.

## What it is

- Super Admin opens on **Growth**: traffic (PostHog, read server-side) next to sign-ups → activation → paid (database),
  compared with the period before, internal orgs left out. Definitions are in the tab ("How each number is counted").
- `organizations.is_internal`, set from the Orgs tab (flag button). Browser roles can't change it (trigger).
- `update_org_activity` now only counts a real member of the org: it accepted any caller (anon too) for any org,
  and counted Super Admin "view as" as the owner coming back.
- `js/analytics.js` v=2: identify / group / reset queue until PostHog loads; the visit's source rides in one
  `?src=` param (no storage) and is saved on sign-up as `signup_source`; off for notrack, DNT and GPC.
- `signup_page_viewed` had never fired: the inline script ran before the deferred analytics.js.

## Verification

- PGlite bench (prod shape + the real functions it replaces): 69 checks, 15/15 mutants caught.
- vitest 1459 → 1517, all green; check-i18n in sync.
- Live: anon gets 42501 on all 4 RPCs; the edge function answers 401 without a token and with the anon key;
  all-time sign-ups = Orgs tab businesses (7 = 9 − 2 internal); boot check of home, pricing, a blog post,
  login, signup, dashboard: no console errors; link decoration checked on the live homepage.

## Open

- Mark the test org from the sign-up test internal.

## Traffic connected (16:15 UTC)

- Secret `POSTHOG_PERSONAL_API_KEY` set (query:read, project 550932); the key never went through the chat.
- Checked against PostHog's own data, day by day: the tab's visitors and pageviews match PostHog for royaltyapp.ai
  marketing pages (Nov 22: 6/8, 23: 3/3, 24: 3/4, 25: 3/7). PostHog Web Analytics shows more (23 visitors in
  90 days) because it also counts `/app/` pages and one localhost visit; the tab counts marketing pages only.
- Marketing pages have sent pageviews only since 2026-11-22 09:32 UTC, so every comparison with an earlier
  period reads "up from 0" until a full period has passed.
- Hero funnel matches (one visitor on Nov 22: started, analyzed, preview). `signup_page_viewed` has never fired
  before today's fix, so "reached sign-up" counts from today on.

## Follow-up the same day: the noticed items, fixed (`014fedf`)

- 13:47:54 migration `20261125000002_billing_guard_admin_plan_impersonation.sql`; frontend live about 13:48:37.
- `organizations_guard_billing`: browser roles can't change plan, tier, status, Stripe ids, overrides, AppSumo or
  payment-failure columns. Before, an owner could give their own org Scale from the browser (checked live with a
  same-value write). After: refused with 42501, naming the columns; name, Settings AI fields and Royal AI answers
  still save.
- `add_messaging_credits`, `increment_email_usage`, `increment_sms_usage`: service_role only. Anon could run them.
- Edit Plan modal: Free / Starter / Growth / Scale (Pro, Max as legacy). Only differences from the chosen plan are
  saved; every save used to pin all seven features to the old plan's values. `{}` now clears overrides.
- `admin_start_impersonation`: "view as" on your own org leaves your row alone (it used to be deleted on stop).
  Checked live on Royalty: owner before, during and after.
- Bench: pglite/run2.mjs 50 checks, mut2.mjs 16/16; vitest 1532.

## End-to-end sign-up test (16:56 UTC)

- A fresh browser profile (no Do Not Track) opened the homepage with a test UTM, went to Pricing, clicked Growth
  and signed up. The source rode `?src=` through each page and was saved on the account as `signup_source`
  (campaign, landing page, plan). It shows in Growth under Sources and Recent sign-ups.
- PostHog recorded the same path: homepage (with the UTM), pricing, sign-up page, `signup_page_viewed` with the
  plan, `account_created`.
- The CAPTCHA refuses a browser driven by test automation, so the form itself was filled by hand.
- The email confirmation link signs in whichever browser opens it, replacing the session already there.
