-- Fix: organization_invitations exposed every pending invitation's email,
-- role, org and token to any authenticated user via the "Anyone can view
-- invitations by token" policy (USING (true)) in database/settings-migration.sql.
--
-- The only reader that exists is app/settings.js, which is already covered
-- by the "Org admins can view invitations" policy. That table was hand-applied
-- outside migration history, so guard with to_regclass.

DO $$
BEGIN
    IF to_regclass('public.organization_invitations') IS NOT NULL THEN
        DROP POLICY IF EXISTS "Anyone can view invitations by token" ON organization_invitations;
    END IF;
END $$;
