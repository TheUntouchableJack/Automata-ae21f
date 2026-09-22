-- venues.created_by_user_id — provenance, NOT ownership.
--
-- Why
-- ---
-- Manual venue entry (Phase 2) lets an org member type a venue in by hand when
-- OpenStreetMap cannot find it. That makes "who put this here?" a question with
-- an answer worth keeping, and it is the one column that keeps a later move to
-- per-venue ownership ADDITIVE rather than archaeological.
--
-- ⚠️ THIS IS NOT AN OWNERSHIP GRANT, and nothing reads it for authorization.
--
-- "Venue owner" is not a modelled concept in ViibeView today. Ownership is
-- org-wide: the "Org members can manage venues" policy (20260225000001:69)
-- tests only for an organization_members row and never inspects role or venue,
-- so any member of the app's org can manage EVERY venue in it. Per the product
-- decision that is correct for now — it is Pahkie's org and nobody else's.
--
-- When per-venue owners do arrive, the shape is:
--
--   1. CREATE TABLE venue_managers (venue_id, user_id, role, …)
--   2. INSERT INTO venue_managers SELECT id, created_by_user_id, 'owner'
--        FROM venues WHERE created_by_user_id IS NOT NULL;   -- seeded from here
--   3. the policy grows `OR EXISTS (SELECT 1 FROM venue_managers …)`
--
-- Nothing built now has to be unbuilt, and step 2 is only possible if this
-- column exists from the start. That is the entire reason it ships today.
--
-- ON DELETE SET NULL, not CASCADE: a user deleting their account must not take
-- the venue with them. Nullable for the same reason, and because every venue
-- that already exists predates this column and has no answer.
--
-- Rollback
-- --------
-- ALTER TABLE venues DROP COLUMN created_by_user_id;
-- Nothing reads it for authorization, so dropping it changes no access.

ALTER TABLE venues
    ADD COLUMN IF NOT EXISTS created_by_user_id UUID
        REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN venues.created_by_user_id IS
    'Who created this venue row. PROVENANCE ONLY — this is NOT an ownership '
    'grant and no RLS policy reads it. Venue management is org-wide via '
    'organization_members (policy "Org members can manage venues"). Kept so a '
    'future venue_managers table can be seeded from it without archaeology.';

-- No index. Nothing filters on it — the only planned reader is a one-off
-- INSERT … SELECT during a future migration, which is a seq scan either way.

-- No grant change. The column is reachable through the same "Org members can
-- manage venues" policy that already governs every other column on this table;
-- SELECT on venues is otherwise public via "Public can view active venues",
-- which is table-wide and needs nothing added.


-- ===== Post-install assertion =====

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'venues'
          AND column_name = 'created_by_user_id'
          AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION
            'venues.created_by_user_id is missing or NOT NULL — the client sends null for every venue added before it existed';
    END IF;
END $$;
