-- =============================================
-- admin_get_all_apps()
-- Super-admin: list every org's customer_apps for the unified "All Apps" tab.
-- Mirrors admin_get_all_organizations() — SECURITY DEFINER, is_admin-gated,
-- read-only. No RLS changes; opening an app reuses admin impersonation.
--
-- ⚠️ SUPERSEDED — DO NOT RE-RUN THIS FILE. It is kept only as history.
--
-- 20260722000002_custom_domains.sql (section 5) DROPs this function and
-- recreates it with two extra columns, custom_domain and domain_status. That
-- migration is applied in prod; this one never was, so for over a month a bare
-- `db push` kept trying to apply THIS definition on top of the newer one and
-- died every time on:
--
--     ERROR: cannot change return type of existing function (SQLSTATE 42P13)
--
-- That error was Postgres refusing a regression, not a problem to route around:
-- succeeding would have dropped the two domain columns from the live function.
--
-- Resolved 2026-09-04 with `supabase migration repair --status applied
-- 20260722000001` — the ledger row was written WITHOUT executing the file, so
-- prod keeps the 12-column version from ...0002. Verified afterwards: the
-- function still answers, and `db push --include-all --dry-run` no longer
-- sweeps this file in.
--
-- If you ever need the current shape, read ...0002 section 5, not this.
-- =============================================
CREATE OR REPLACE FUNCTION admin_get_all_apps()
RETURNS TABLE (
    id UUID,
    name TEXT,
    slug TEXT,
    app_type TEXT,
    is_published BOOLEAN,
    is_active BOOLEAN,
    created_at TIMESTAMPTZ,
    organization_id UUID,
    org_name TEXT,
    org_slug TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    -- Verify caller is super admin
    IF NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: super admin required';
    END IF;

    RETURN QUERY
    SELECT
        ca.id,
        ca.name::TEXT,
        ca.slug::TEXT,
        ca.app_type::TEXT,
        ca.is_published::BOOLEAN,
        ca.is_active::BOOLEAN,
        ca.created_at,
        ca.organization_id,
        o.name::TEXT AS org_name,
        o.slug::TEXT AS org_slug
    FROM customer_apps ca
    JOIN organizations o ON o.id = ca.organization_id
    WHERE ca.deleted_at IS NULL
    ORDER BY ca.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_all_apps() TO authenticated;
