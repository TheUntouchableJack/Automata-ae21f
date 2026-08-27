-- Open ViibeView posting to members: venue_media shape changes.
--
-- Why
-- ---
-- Posting has never been open to anyone but an org member. A ViibeView member
-- has a `profiles` row and NO organization at all (20260821000004), so they
-- satisfy neither "Org members can manage venue media" nor the venue-media
-- storage policies (which key on an organization id in the path prefix). The
-- symptom Jay reported — every test post authored by "General / General" — is
-- the auto-created fallback venue that `getOrCreateDefaultVenue()` minted
-- because a post HAD to belong to a venue.
--
-- This migration makes a post able to stand on its own:
--   * venue_id becomes NULLABLE — a Viibe recorded on the street belongs to
--     its author, not to a venue that had to be invented for it.
--   * latitude/longitude on the post itself, so the map can pin where the
--     Viibe was actually shot rather than where its venue sits.
--   * authors can delete their own posts.
--
-- Touches venue_media and nothing else. The write path (create/delete RPCs and
-- the member storage policy) is 20260828000002.
--
-- Rollback
-- --------
--   DROP POLICY "Authors can delete own venue media" ON venue_media;
--   DROP INDEX IF EXISTS idx_venue_media_geo;
--   DROP INDEX IF EXISTS idx_venue_media_author;
--   ALTER TABLE venue_media DROP COLUMN IF EXISTS longitude;
--   ALTER TABLE venue_media DROP COLUMN IF EXISTS latitude;
--   -- Restoring NOT NULL requires every venue-less row to be deleted or
--   -- reassigned first; it will fail while any exists. That is intentional.
--   ALTER TABLE venue_media ALTER COLUMN venue_id SET NOT NULL;


-- ===== 1. venue_id becomes optional =====
--
-- Why this is safe: sync_venue_media_count() (20260821000001, lines 50-88) is
-- the only thing that reads NEW.venue_id, and it does
-- `UPDATE venues ... WHERE id = NEW.venue_id`. With NULL that matches zero
-- rows and returns cleanly — no error, no drift, because a venue-less post
-- should not count towards any venue. Nothing else assumes NOT NULL.
-- idx_venue_media_venue keeps working; NULLs are simply not indexed, and no
-- lookup by venue ever wants them.
ALTER TABLE venue_media ALTER COLUMN venue_id DROP NOT NULL;

COMMENT ON COLUMN venue_media.venue_id IS
    'Venue this Viibe was posted at, or NULL for a member post with no venue attached. Venue-less posts are attributed to their author (uploaded_by_user_id) and surface under "All" only — they have no category to filter on. See get_venue_feed in 20260828000003.';


-- ===== 2. Where the post was actually recorded =====
--
-- Same DECIMAL(10,7) as venues.latitude/longitude so the two can be compared
-- and COALESCEd without a cast.
ALTER TABLE venue_media ADD COLUMN IF NOT EXISTS latitude  DECIMAL(10,7);
ALTER TABLE venue_media ADD COLUMN IF NOT EXISTS longitude DECIMAL(10,7);

COMMENT ON COLUMN venue_media.latitude IS
    'Where the clip was recorded, captured from the device at post time. NULL when the member declined location. Falls back to the venue coordinates for map pins.';


-- ===== 3. Indexes =====

-- "my posts" lookups and the delete-authorization check.
CREATE INDEX IF NOT EXISTS idx_venue_media_author
    ON venue_media(uploaded_by_user_id) WHERE uploaded_by_user_id IS NOT NULL;

-- Drives get_recent_post_pins: newest approved posts that have their own
-- coordinates, per app.
CREATE INDEX IF NOT EXISTS idx_venue_media_geo
    ON venue_media(app_id, created_at DESC)
    WHERE status = 'approved' AND latitude IS NOT NULL;


-- ===== 4. Authors can delete their own posts =====
--
-- RLS rather than an RPC, because this needs no privilege the member lacks:
-- the row is theirs and auth.uid() is authoritative. The delete_social_post
-- RPC in 20260828000002 exists for a different reason — it also removes the
-- storage object in the same transaction — but this policy is what makes the
-- underlying DELETE legal, and it is the honest statement of who may delete.
--
-- Note: every row that existed before this migration has
-- uploaded_by_user_id = NULL (the column has never been written), so this
-- policy grants nothing over historical posts. Those remain org-member-only,
-- which is correct — nobody can prove authorship of them.
DROP POLICY IF EXISTS "Authors can delete own venue media" ON venue_media;
CREATE POLICY "Authors can delete own venue media"
ON venue_media FOR DELETE TO authenticated
USING (uploaded_by_user_id = auth.uid());
