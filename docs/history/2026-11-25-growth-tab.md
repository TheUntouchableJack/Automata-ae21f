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

- PostHog personal API key (query:read, project 550932) → secret `POSTHOG_PERSONAL_API_KEY`. Until then the tab
  says "Traffic not connected".
- One real sign-up from a browser without Do Not Track, to see a source land in Recent sign-ups.
