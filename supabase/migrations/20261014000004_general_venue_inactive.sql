-- The "General" venue is retired (Jay, 2026-10-14).
--
-- Why
-- ---
-- Before venue_id was nullable, submitPost() invented a "General" venue for
-- every post with no venue, and it was given coordinates 42.6633415, 2.9048665
-- — near Perpignan, in France. Every map that fits its pins zoomed out to a
-- transatlantic view, and every distance list put a French "venue" 5,000+
-- miles from LA (Jay's board: "Map proximity accuracy").
--
-- Why not just clear its coordinates
-- ----------------------------------
-- That was the plan, and prod refused it: venues_active_requires_coordinates
-- (20260823000002) — an ACTIVE venue must have coordinates. Jay chose to
-- deactivate it instead.
--
-- What it does
-- ------------
-- is_active = false on that one row. Its coordinates, posts and follows are
-- untouched. Every reader already requires an active venue, so General leaves
-- the map, the card strip, the venue lists and the composer's venue picker.
-- ⚠️ Its one post (an author-less test clip from 2026-08-24, Jay's) is hidden
-- with it: the feeds join venues with is_active = true. Jay agreed to that.
--
-- Matched by id AND name, and only while active, so running it twice is a
-- no-op.
--
-- Rollback:
--   UPDATE venues SET is_active = true
--   WHERE id = '81bdf625-0dbc-458c-bcee-be831a28adec';

DO $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE venues
    SET is_active = false
    WHERE id = '81bdf625-0dbc-458c-bcee-be831a28adec'
      AND name = 'General'
      AND is_active = true;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated > 1 THEN
        RAISE EXCEPTION 'General venue: % rows matched, expected 1', v_updated;
    END IF;

    -- 0 rows is fine only if it is already inactive (or gone).
    IF v_updated = 0 AND EXISTS (
        SELECT 1 FROM venues
        WHERE id = '81bdf625-0dbc-458c-bcee-be831a28adec'
          AND is_active = true
    ) THEN
        RAISE EXCEPTION 'General venue: still active, but the name did not match — not touching it';
    END IF;
END $$;
