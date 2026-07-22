-- =============================================
-- admin_get_all_apps()
-- Super-admin: list every org's customer_apps for the unified "All Apps" tab.
-- Mirrors admin_get_all_organizations() — SECURITY DEFINER, is_admin-gated,
-- read-only. No RLS changes; opening an app reuses admin impersonation.
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
