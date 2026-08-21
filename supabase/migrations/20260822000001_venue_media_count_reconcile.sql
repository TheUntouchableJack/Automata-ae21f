-- Reconcile venues.media_count after the double-count regression.
--
-- 20260821000001_social_repair.sql replaced the client-side read-modify-write
-- with trg_venue_media_count, but app/venues.html still had its own
-- increment/decrement in uploadMedia() and deleteMedia(), so every admin
-- upload/delete since then double-counted (or under-counted) against the
-- trigger. Re-running the exact reconcile block, verbatim, to fix the drift.

UPDATE venues v
SET media_count = actual.cnt
FROM (
    SELECT v2.id, COUNT(vm.id)::INTEGER AS cnt
    FROM venues v2
    LEFT JOIN venue_media vm ON vm.venue_id = v2.id
    GROUP BY v2.id
) actual
WHERE v.id = actual.id
  AND COALESCE(v.media_count, -1) IS DISTINCT FROM actual.cnt;
