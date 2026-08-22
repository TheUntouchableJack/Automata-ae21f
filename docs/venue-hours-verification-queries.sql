-- Read-only checks for the venues.hours work (V1) and the owner-account
-- question (V5). Run in the Supabase SQL editor against PROD
-- (vhpmmfhfwnpmavytoomd). Nothing here writes.

-- =====================================================================
-- 1. Hours shape distribution — run BEFORE and AFTER, record both.
-- =====================================================================
-- The bug this work fixes was invisible: hand-added venues rendered
-- "Closed" seven days a week on the public page under a green success
-- toast. The counts are the only way to see what is actually out there.
--
-- Expected: some 'legacy text (C)' rows (every venue typed by hand) and
-- some 'schedule (B)' rows (the seeded demo venues). 'abbreviated (A)'
-- should be ZERO — that shape is documented in the original DDL comment
-- but has never been written by anything.

SELECT CASE
  WHEN hours IS NULL OR hours = '{}'::jsonb THEN 'empty'
  WHEN hours ? 'text'                        THEN 'legacy text (C)'
  WHEN hours ?| ARRAY['monday','tuesday','wednesday','thursday',
                      'friday','saturday','sunday'] THEN 'schedule (B)'
  WHEN hours ?| ARRAY['mon','tue','wed','thu','fri','sat','sun']
                                             THEN 'abbreviated (A)'
  ELSE 'unknown' END AS shape, count(*)
FROM venues WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC;


-- The actual rows, so the "before" state is recoverable if anything goes
-- wrong later. venues.hours is NOT audit-logged — this output is the only
-- backup that will exist.
SELECT id, name, hours
FROM venues
WHERE deleted_at IS NULL AND hours IS NOT NULL AND hours <> '{}'::jsonb
ORDER BY name;


-- =====================================================================
-- 2. V5 — the "Pahkie" lookup (BLOCKING, decides the next step)
-- =====================================================================
-- The name appears nowhere in the Automata repo, the plans, the memory
-- notes, or the ViibeView proposal (whose contact fields are empty).
-- Replace the search term below with the real name/email before running.
--
-- Read the three results together:
--
--   * a profiles / auth.users row exists  -> only needs an
--     organization_members row. Nothing irreversible.
--   * only an app_members row exists      -> that is a CUSTOMER who signed
--     up through the social app, NOT venue-admin access. They still need a
--     Royalty auth account plus the membership row.
--   * nothing exists                      -> create the user with
--     user_metadata { user_type: 'app_member' } so handle_new_user()'s
--     existing app_member branch fires, then insert the membership row.
--     This is the irreversible step and needs an explicit go-ahead.

\set term 'pahkie'

-- 2a. Royalty auth accounts
SELECT p.id, p.email, p.first_name, p.last_name, p.is_admin, p.created_at
FROM profiles p
WHERE p.email ILIKE '%pahkie%'
   OR p.first_name ILIKE '%pahkie%'
   OR p.last_name ILIKE '%pahkie%';

-- 2b. Existing org membership (does the account already have access?)
SELECT om.organization_id, o.name AS org_name, om.user_id, p.email, om.role
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id
LEFT JOIN profiles p ON p.id = om.user_id
WHERE p.email ILIKE '%pahkie%'
   OR o.name ILIKE '%viibe%';

-- 2c. Customer-app members (signed up through the social app, NOT admin)
SELECT am.id, am.app_id, ca.name AS app_name, ca.app_type,
       am.email, am.first_name, am.last_name, am.created_at
FROM app_members am
JOIN customer_apps ca ON ca.id = am.app_id
WHERE am.email ILIKE '%pahkie%'
   OR am.first_name ILIKE '%pahkie%'
   OR am.last_name ILIKE '%pahkie%';

-- 2d. Context: which org owns the ViibeView social app, and who is in it
SELECT ca.id AS app_id, ca.name, ca.slug, ca.app_type,
       o.id AS org_id, o.name AS org_name
FROM customer_apps ca
JOIN organizations o ON o.id = ca.organization_id
WHERE ca.app_type = 'social' AND ca.deleted_at IS NULL;
