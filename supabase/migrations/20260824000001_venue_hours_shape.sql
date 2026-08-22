-- Document the canonical shape of venues.hours.
--
-- Comment only. No UPDATE, no CHECK constraint. Read the reasoning before
-- adding either.
--
-- Background
-- ----------
-- The DDL comment in 20260225000001_social_venue_discovery.sql (line 36)
-- documented this column as
--
--     {"mon": "5pm-2am", "tue": "5pm-2am", ...}
--
-- Nothing has ever written that shape. It is the origin of the bug: two later
-- authors each read the column, found no implementation to match, and invented
-- their own. Three shapes ended up on disk:
--
--   Shape A  {"mon": "5pm-2am"}                       documented, never written
--   Shape B  {"monday": {"open":"17:00","close":"02:00"}}   seeded demo venues
--   Shape C  {"text": "Mon-Thu: 5PM - 12AM\n..."}     every hand-added venue
--
-- Shape C existed because app/venues.html had a free-text textarea whose
-- placeholder taught free text, and saveVenue() wrapped anything that failed
-- JSON.parse in {text: ...}. The customer app's reader understood only Shape B,
-- so Shape C fell through its per-day lookup and rendered "Closed" seven days a
-- week on the public venue page — under a green "Venue added" toast.
--
-- Why no data migration
-- ---------------------
-- The reader now normalizes all three shapes through /js/venue-hours.js, so
-- every existing row renders correctly as it stands. Rewriting the data buys
-- nothing user-visible, and:
--
--   * Shape C cannot be safely converted. Parsing "Mon-Thu: 5PM - 12AM" is
--     ~80% accurate at best, and an 80%-accurate parser publishes
--     plausible-looking WRONG hours on a public page — strictly worse than
--     hours that are obviously broken.
--   * Shape A is the only mechanically convertible shape, and it has never
--     been written by anything. There is nothing to convert.
--
-- Why no CHECK constraint
-- -----------------------
-- A CHECK expressive enough to validate the nested day/span structure needs a
-- PL/pgSQL function, and function-backed CHECKs are a documented footgun: the
-- body can change without revalidating existing rows, and pg_dump ordering can
-- restore the constraint before the function exists. It would also have to ship
-- NOT VALID (as 20260823000002 did), so it would guard only new writes — which
-- readHoursFromForm() in app/venues.html already makes impossible to get wrong.
-- tests/venue-hours.test.js is the guard instead.

COMMENT ON COLUMN public.venues.hours IS
$$Operating hours, keyed by full lowercase day name.

Canonical shape (written by app/venues.html):
  {"monday": {"open": "17:00", "close": "02:00"}, ..., "sunday": null}

  - Keys are the seven full lowercase day names: monday .. sunday.
  - A day maps to null when the venue is closed that day.
  - Times are 24-hour "HH:MM". close <= open means the venue closes after
    midnight (bars: 16:00 -> 02:00). This is normal, not an error.
  - {} or NULL means the owner has not entered hours; the customer app renders
    no Hours section at all — NOT a week of "Closed".

Legacy shapes still present on disk and still readable:
  {"mon": "5pm-2am"}                free-text per day, abbreviated keys
  {"text": "Mon-Thu: 5PM - 12AM"}   free text typed into the old textarea

All shapes are normalized by /js/venue-hours.js, which BOTH
customer-app/social.js and app/venues.html load. Do not hand-write shape
detection anywhere else — that is exactly how these three shapes appeared.$$;


-- Shape distribution. Run this before and after any future change to this
-- column; the counts are the only way to see what is actually out there.
--
--   SELECT CASE
--     WHEN hours IS NULL OR hours = '{}'::jsonb THEN 'empty'
--     WHEN hours ? 'text'                        THEN 'legacy text (C)'
--     WHEN hours ?| ARRAY['monday','tuesday','wednesday','thursday',
--                         'friday','saturday','sunday'] THEN 'schedule (B)'
--     WHEN hours ?| ARRAY['mon','tue','wed','thu','fri','sat','sun']
--                                                THEN 'abbreviated (A)'
--     ELSE 'unknown' END AS shape, count(*)
--   FROM venues WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC;
