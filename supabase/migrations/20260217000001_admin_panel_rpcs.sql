-- =============================================
-- Super Admin Panel: RPC Functions + Schema
-- =============================================
-- Provides cross-org admin capabilities for super admins (profiles.is_admin = TRUE)
-- All functions use SECURITY DEFINER with internal admin guard

-- 1. Add impersonation tracking column to organization_members
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS is_impersonating BOOLEAN DEFAULT FALSE;

-- =============================================
-- admin_get_all_organizations()
-- Returns all orgs with owner info and aggregated counts
-- =============================================
CREATE OR REPLACE FUNCTION admin_get_all_organizations()
RETURNS TABLE (
    id UUID,
    name TEXT,
    slug TEXT,
    plan_type TEXT,
    subscription_tier TEXT,
    appsumo_tier INT,
    has_royalty_pro BOOLEAN,
    subscription_status TEXT,
    plan_limits_override JSONB,
    created_at TIMESTAMPTZ,
    owner_email TEXT,
    owner_name TEXT,
    member_count BIGINT,
    customer_count BIGINT,
    last_activity TIMESTAMPTZ
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
        o.id,
        o.name::TEXT,
        o.slug::TEXT,
        o.plan_type::TEXT,
        o.subscription_tier::TEXT,
        o.appsumo_tier::INT,
        o.has_royalty_pro::BOOLEAN,
        o.subscription_status::TEXT,
        o.plan_limits_override,
        o.created_at,
        p.email::TEXT AS owner_email,
        CONCAT(p.first_name, ' ', p.last_name)::TEXT AS owner_name,
        (SELECT COUNT(*) FROM organization_members om
         WHERE om.organization_id = o.id AND om.is_impersonating = false) AS member_count,
        (SELECT COUNT(*) FROM customers c
         WHERE c.organization_id = o.id AND c.deleted_at IS NULL) AS customer_count,
        GREATEST(
            o.created_at,
            (SELECT MAX(al.created_at) FROM audit_logs al WHERE al.organization_id = o.id)
        ) AS last_activity
    FROM organizations o
    LEFT JOIN organization_members om ON om.organization_id = o.id
        AND om.role = 'owner' AND om.is_impersonating = false
    LEFT JOIN profiles p ON p.id = om.user_id
    ORDER BY o.created_at DESC;
END;
$$;

-- =============================================
-- admin_get_organization_detail(p_org_id)
-- Returns full org details: settings, team, apps, recent audit
-- =============================================
CREATE OR REPLACE FUNCTION admin_get_organization_detail(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: super admin required';
    END IF;

    SELECT jsonb_build_object(
        'organization', (
            SELECT row_to_json(org_data.*)
            FROM (
                SELECT o.id, o.name, o.slug, o.plan_type, o.subscription_tier,
                       o.appsumo_tier, o.has_royalty_pro, o.subscription_status,
                       o.plan_limits_override, o.settings, o.created_at,
                       o.stripe_customer_id, o.stripe_subscription_id,
                       o.plan_changed_at
                FROM organizations o WHERE o.id = p_org_id
            ) org_data
        ),
        'members', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'user_id', om.user_id,
                'role', om.role,
                'joined_at', om.joined_at,
                'email', p.email,
                'first_name', p.first_name,
                'last_name', p.last_name,
                'is_impersonating', om.is_impersonating
            ))
            FROM organization_members om
            JOIN profiles p ON p.id = om.user_id
            WHERE om.organization_id = p_org_id
        ), '[]'::jsonb),
        'customer_apps', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', ca.id,
                'name', ca.name,
                'created_at', ca.created_at
            ))
            FROM customer_apps ca
            WHERE ca.organization_id = p_org_id
            AND ca.deleted_at IS NULL
        ), '[]'::jsonb),
        'recent_audit', COALESCE((
            SELECT jsonb_agg(row_to_json(audit_data.*))
            FROM (
                SELECT al.id, al.action, al.entity_type, al.entity_name,
                       al.user_email, al.changes_summary, al.created_at
                FROM audit_logs al
                WHERE al.organization_id = p_org_id
                ORDER BY al.created_at DESC
                LIMIT 20
            ) audit_data
        ), '[]'::jsonb),
        'usage', (
            SELECT jsonb_build_object(
                'customers', (SELECT COUNT(*) FROM customers c
                              WHERE c.organization_id = p_org_id AND c.deleted_at IS NULL),
                'automations', (SELECT COUNT(*) FROM automation_definitions ad
                                WHERE ad.organization_id = p_org_id AND NOT ad.is_archived),
                'knowledge_facts', (SELECT COUNT(*) FROM business_knowledge bk
                                    WHERE bk.organization_id = p_org_id AND bk.status = 'active')
            )
        )
    ) INTO result;

    RETURN result;
END;
$$;

-- =============================================
-- admin_update_organization_plan(...)
-- Change plan type/tier + set custom limit overrides
-- =============================================
CREATE OR REPLACE FUNCTION admin_update_organization_plan(
    p_org_id UUID,
    p_plan_type TEXT DEFAULT NULL,
    p_subscription_tier TEXT DEFAULT NULL,
    p_plan_limits_override JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: super admin required';
    END IF;

    UPDATE organizations SET
        plan_type = COALESCE(p_plan_type, plan_type),
        subscription_tier = COALESCE(p_subscription_tier, subscription_tier),
        plan_limits_override = CASE
            WHEN p_plan_limits_override IS NOT NULL THEN p_plan_limits_override
            ELSE plan_limits_override
        END,
        plan_changed_at = NOW()
    WHERE id = p_org_id
    RETURNING jsonb_build_object(
        'id', id,
        'name', name,
        'plan_type', plan_type,
        'subscription_tier', subscription_tier,
        'plan_limits_override', plan_limits_override,
        'plan_changed_at', plan_changed_at
    ) INTO result;

    RETURN result;
END;
$$;

-- =============================================
-- admin_get_all_users()
-- Returns all user profiles with org memberships
-- =============================================
CREATE OR REPLACE FUNCTION admin_get_all_users()
RETURNS TABLE (
    id UUID,
    email TEXT,
    first_name TEXT,
    last_name TEXT,
    is_admin BOOLEAN,
    created_at TIMESTAMPTZ,
    org_count BIGINT,
    orgs JSONB
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: super admin required';
    END IF;

    RETURN QUERY
    SELECT
        p.id,
        p.email::TEXT,
        p.first_name::TEXT,
        p.last_name::TEXT,
        p.is_admin,
        p.created_at,
        (SELECT COUNT(*) FROM organization_members om
         WHERE om.user_id = p.id AND om.is_impersonating = false) AS org_count,
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'org_id', o.id,
                'org_name', o.name,
                'role', om.role
            ))
            FROM organization_members om
            JOIN organizations o ON o.id = om.organization_id
            WHERE om.user_id = p.id AND om.is_impersonating = false
        ), '[]'::jsonb) AS orgs
    FROM profiles p
    ORDER BY p.created_at DESC;
END;
$$;

-- =============================================
-- admin_delete_organization(p_org_id)
-- Hard delete org + all cascading data
-- =============================================
CREATE OR REPLACE FUNCTION admin_delete_organization(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: super admin required';
    END IF;

    -- CASCADE constraints handle child tables
    DELETE FROM organizations WHERE id = p_org_id;

    RETURN TRUE;
END;
$$;

-- =============================================
-- admin_remove_user_from_org(p_user_id, p_org_id)
-- Remove a user from an organization
-- =============================================
CREATE OR REPLACE FUNCTION admin_remove_user_from_org(p_user_id UUID, p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: super admin required';
    END IF;

    DELETE FROM organization_members
    WHERE user_id = p_user_id AND organization_id = p_org_id;

    RETURN TRUE;
END;
$$;

-- =============================================
-- admin_start_impersonation(p_org_id)
-- Temporarily add admin as org member for "View as Org"
-- =============================================
CREATE OR REPLACE FUNCTION admin_start_impersonation(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    admin_id UUID;
    org_record RECORD;
BEGIN
    admin_id := auth.uid();

    IF NOT EXISTS (
        SELECT 1 FROM profiles WHERE profiles.id = admin_id AND profiles.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: super admin required';
    END IF;

    -- Clean up any existing impersonation records for this admin
    DELETE FROM organization_members
    WHERE user_id = admin_id AND is_impersonating = true;

    -- Add admin as temporary member
    INSERT INTO organization_members (organization_id, user_id, role, is_impersonating)
    VALUES (p_org_id, admin_id, 'admin', true)
    ON CONFLICT (organization_id, user_id)
    DO UPDATE SET is_impersonating = true, role = 'admin';

    -- Return org details
    SELECT o.id, o.name, o.slug, o.plan_type, o.subscription_tier,
           o.appsumo_tier, o.plan_limits_override
    INTO org_record
    FROM organizations o WHERE o.id = p_org_id;

    RETURN jsonb_build_object(
        'id', org_record.id,
        'name', org_record.name,
        'slug', org_record.slug,
        'plan_type', org_record.plan_type,
        'subscription_tier', org_record.subscription_tier,
        'appsumo_tier', org_record.appsumo_tier,
        'plan_limits_override', org_record.plan_limits_override
    );
END;
$$;

-- =============================================
-- admin_stop_impersonation()
-- Remove all impersonation records for current admin
-- =============================================
CREATE OR REPLACE FUNCTION admin_stop_impersonation()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: super admin required';
    END IF;

    DELETE FROM organization_members
    WHERE user_id = auth.uid() AND is_impersonating = true;

    RETURN TRUE;
END;
$$;

-- =============================================
-- Grant execution to authenticated users
-- (admin guard inside each function handles authorization)
-- =============================================
GRANT EXECUTE ON FUNCTION admin_get_all_organizations() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_organization_detail(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_organization_plan(UUID, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_all_users() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_organization(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_remove_user_from_org(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_start_impersonation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_stop_impersonation() TO authenticated;
