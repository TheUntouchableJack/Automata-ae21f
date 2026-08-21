-- Social app type (ViibeView) — Phase 0 repair
--
-- Two fixes, both invisible until now because the customer app falls back to
-- hardcoded demo venues whenever the DB returns zero rows:
--
--   1. Category vocabulary. The feed's filter pills sent plural slugs
--      ('bars', 'clubs', 'restaurants', 'lounges') while venues.category
--      stores singulars, so five of seven pills matched nothing. The client is
--      now driven by /js/venue-categories.js; this normalizes any rows that
--      were written with the plural form and adds a CHECK so they can't come
--      back.
--
--   2. venues.media_count was maintained by a read-modify-write in the browser
--      (SELECT current value, then UPDATE count + 1). Two concurrent uploads
--      lose one increment. Replaced with a trigger on venue_media.
--
-- Isolated migration: touches only venues / venue_media, both introduced by
-- 20260225000001_social_venue_discovery.sql.

-- ===== 1. Category normalization =====

-- Fold plural values onto their singular equivalents. No-ops on a clean DB.
UPDATE venues SET category = 'bar'        WHERE category = 'bars';
UPDATE venues SET category = 'club'       WHERE category = 'clubs';
UPDATE venues SET category = 'restaurant' WHERE category = 'restaurants';
UPDATE venues SET category = 'lounge'     WHERE category = 'lounges';

-- 'general' was written by the customer app's auto-created fallback venue and
-- is not a real category — such a venue's posts only ever showed under "All".
UPDATE venues SET category = 'nightlife' WHERE category = 'general';

-- Anything still outside the vocabulary becomes the default rather than
-- blocking the constraint below.
UPDATE venues
SET category = 'nightlife'
WHERE category IS NOT NULL
  AND category NOT IN ('nightlife', 'bar', 'club', 'restaurant', 'lounge', 'rooftop', 'event_space');

ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_category_valid;
ALTER TABLE venues ADD CONSTRAINT venues_category_valid
    CHECK (category IS NULL OR category IN (
        'nightlife', 'bar', 'club', 'restaurant', 'lounge', 'rooftop', 'event_space'
    ));

COMMENT ON COLUMN venues.category IS
    'Venue category. Must match a slug in /js/venue-categories.js, which drives both the customer app filter pills and the admin dropdown. Enforced by venues_category_valid.';

-- ===== 2. Atomic media_count =====

CREATE OR REPLACE FUNCTION sync_venue_media_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE venues
        SET media_count = GREATEST(0, COALESCE(media_count, 0) + 1)
        WHERE id = NEW.venue_id;
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        UPDATE venues
        SET media_count = GREATEST(0, COALESCE(media_count, 0) - 1)
        WHERE id = OLD.venue_id;
        RETURN OLD;

    -- A media row can be reassigned to a different venue; move the count too.
    ELSIF TG_OP = 'UPDATE' AND NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
        UPDATE venues
        SET media_count = GREATEST(0, COALESCE(media_count, 0) - 1)
        WHERE id = OLD.venue_id;
        UPDATE venues
        SET media_count = GREATEST(0, COALESCE(media_count, 0) + 1)
        WHERE id = NEW.venue_id;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_venue_media_count ON venue_media;
CREATE TRIGGER trg_venue_media_count
    AFTER INSERT OR DELETE OR UPDATE OF venue_id ON venue_media
    FOR EACH ROW
    EXECUTE FUNCTION sync_venue_media_count();

-- Reconcile any drift the old client-side increment already introduced.
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
