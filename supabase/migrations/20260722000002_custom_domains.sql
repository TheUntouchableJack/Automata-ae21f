-- =============================================
-- Custom-Domain / White-Label Hosting for Customer Apps
--
-- Lets a white-label org point their own domain (theirbusiness.com) or a
-- *.royaltyapp.ai subdomain at their customer app, verify ownership, get
-- auto-SSL, and serve a fully un-Royalty-branded experience.
--
-- This migration adds:
--   1. custom_domain / subdomain / provisioning-state columns on customer_apps
--   2. org_has_white_label() helper (mirrors app/plan-limits.js hasWhiteLabel)
--   3. get_app_by_domain() RPC (Host -> app resolver for the edge router)
--   4. is_white_label added to get_app_by_slug() so the client can hide
--      "Powered by Royalty" regardless of which entry path served the page
--   5. custom_domain / domain_status added to admin_get_all_apps()
--
-- Note: 20260722000001 is taken by admin_get_all_apps; this is ...0002.
-- =============================================

-- =====================================================
-- 1. Data model on customer_apps
-- =====================================================
ALTER TABLE customer_apps ADD COLUMN IF NOT EXISTS custom_domain TEXT;             -- full host the client owns, lowercased, no scheme (MVP primary field)
ALTER TABLE customer_apps ADD COLUMN IF NOT EXISTS subdomain TEXT;                 -- optional label for the *.royaltyapp.ai wildcard tier
ALTER TABLE customer_apps ADD COLUMN IF NOT EXISTS domain_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE customer_apps ADD COLUMN IF NOT EXISTS domain_verification_token TEXT; -- random token placed in a TXT record (ownership proof)
ALTER TABLE customer_apps ADD COLUMN IF NOT EXISTS domain_verified_at TIMESTAMPTZ;
ALTER TABLE customer_apps ADD COLUMN IF NOT EXISTS domain_error TEXT;

-- Provisioning state machine: none -> pending_dns -> verifying -> provisioning -> live (or error)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'customer_apps_domain_status_check'
    ) THEN
        ALTER TABLE customer_apps ADD CONSTRAINT customer_apps_domain_status_check
            CHECK (domain_status IN ('none','pending_dns','verifying','provisioning','live','error'));
    END IF;
END $$;

-- Reserved-label denylist for subdomains + basic label shape (letters/digits/hyphen)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'customer_apps_subdomain_check'
    ) THEN
        ALTER TABLE customer_apps ADD CONSTRAINT customer_apps_subdomain_check
            CHECK (
                subdomain IS NULL OR (
                    lower(subdomain) NOT IN ('www','app','api','admin','royaltyapp','mail','ftp','dashboard')
                    AND subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
                )
            );
    END IF;
END $$;

-- One app per domain / per subdomain (case-insensitive), reuse existing 23505 handling
CREATE UNIQUE INDEX IF NOT EXISTS customer_apps_custom_domain_unique
    ON customer_apps (lower(custom_domain)) WHERE custom_domain IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_apps_subdomain_unique
    ON customer_apps (lower(subdomain)) WHERE subdomain IS NOT NULL;

-- =====================================================
-- 2. org_has_white_label() — mirrors app/plan-limits.js hasWhiteLabel()
--    Scale/Max subscriptions, or AppSumo + Royalty Pro add-on, or an
--    explicit plan_limits_override. SECURITY DEFINER so anon callers
--    (via the app-resolving RPCs) can compute it without reading orgs.
-- =====================================================
CREATE OR REPLACE FUNCTION org_has_white_label(p_org_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_org RECORD;
BEGIN
    SELECT plan_type, subscription_tier, appsumo_tier, has_royalty_pro, plan_limits_override
    INTO v_org
    FROM organizations
    WHERE id = p_org_id;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Explicit override wins (matches getOrgLimits spread of plan_limits_override)
    IF v_org.plan_limits_override IS NOT NULL AND v_org.plan_limits_override ? 'white_label' THEN
        RETURN (v_org.plan_limits_override->>'white_label')::BOOLEAN;
    END IF;

    CASE v_org.plan_type
        WHEN 'subscription' THEN
            RETURN v_org.subscription_tier IN ('scale','max');
        WHEN 'appsumo_lifetime' THEN
            RETURN COALESCE(v_org.has_royalty_pro, false);
        ELSE
            RETURN false;
    END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION org_has_white_label(UUID) TO anon, authenticated;

-- =====================================================
-- 3. get_app_by_domain(p_host) — Host -> app resolver
--    Mirrors get_app_by_slug exactly (same gate, same columns) and adds
--    is_white_label so the anon customer page can hide "Powered by Royalty"
--    without leaking plan details.
-- =====================================================
DROP FUNCTION IF EXISTS get_app_by_domain(TEXT);

CREATE OR REPLACE FUNCTION get_app_by_domain(p_host TEXT)
RETURNS TABLE (
    id UUID,
    organization_id UUID,
    name TEXT,
    slug TEXT,
    description TEXT,
    app_type TEXT,
    branding JSONB,
    features JSONB,
    settings JSONB,
    is_white_label BOOLEAN
) AS $$
DECLARE
    v_host TEXT;
BEGIN
    -- Normalise: lowercase, strip scheme + leading www. + any port
    v_host := lower(trim(p_host));
    v_host := regexp_replace(v_host, '^https?://', '');
    v_host := split_part(v_host, '/', 1);
    v_host := split_part(v_host, ':', 1);
    v_host := regexp_replace(v_host, '^www\.', '');

    RETURN QUERY
    SELECT
        ca.id,
        ca.organization_id,
        ca.name,
        ca.slug,
        ca.description,
        ca.app_type,
        ca.branding,
        ca.features,
        jsonb_build_object(
            'welcome_points', ca.settings->'welcome_points',
            'require_email', ca.settings->'require_email',
            'require_phone', ca.settings->'require_phone'
        ) AS settings,
        org_has_white_label(ca.organization_id) AS is_white_label
    FROM customer_apps ca
    WHERE (
            -- *.royaltyapp.ai subdomain tier (matches on the first label)
            (v_host LIKE '%.royaltyapp.ai' AND ca.subdomain IS NOT NULL
                AND lower(ca.subdomain) = split_part(v_host, '.', 1))
            OR
            -- custom apex/domain tier — only once fully provisioned & live
            (v_host NOT LIKE '%.royaltyapp.ai' AND ca.custom_domain IS NOT NULL
                AND lower(ca.custom_domain) = v_host AND ca.domain_status = 'live')
          )
      AND ca.is_published = true
      AND ca.is_active = true
      AND ca.deleted_at IS NULL
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_app_by_domain(TEXT) TO anon, authenticated;

-- =====================================================
-- 4. get_app_by_slug() — add is_white_label so the flag is present on the
--    normal slug/rewrite path too (the edge router rewrites to ?slug=...,
--    and both customer-app/index.html and app.js load via this RPC).
--    Return-type change requires DROP + CREATE.
-- =====================================================
DROP FUNCTION IF EXISTS get_app_by_slug(TEXT);

CREATE OR REPLACE FUNCTION get_app_by_slug(p_slug TEXT)
RETURNS TABLE (
    id UUID,
    organization_id UUID,
    name TEXT,
    slug TEXT,
    description TEXT,
    app_type TEXT,
    branding JSONB,
    features JSONB,
    settings JSONB,
    is_white_label BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ca.id,
        ca.organization_id,
        ca.name,
        ca.slug,
        ca.description,
        ca.app_type,
        ca.branding,
        ca.features,
        jsonb_build_object(
            'welcome_points', ca.settings->'welcome_points',
            'require_email', ca.settings->'require_email',
            'require_phone', ca.settings->'require_phone'
        ) AS settings,
        org_has_white_label(ca.organization_id) AS is_white_label
    FROM customer_apps ca
    WHERE ca.slug = p_slug
      AND ca.is_published = true
      AND ca.is_active = true
      AND ca.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_app_by_slug(TEXT) TO anon, authenticated;

-- =====================================================
-- 5. admin_get_all_apps() — surface domain columns for the super-admin
--    Apps tab (domain column + attach/verify action). Return-type change
--    requires DROP + CREATE.
-- =====================================================
DROP FUNCTION IF EXISTS admin_get_all_apps();

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
    org_slug TEXT,
    custom_domain TEXT,
    domain_status TEXT
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
        o.slug::TEXT AS org_slug,
        ca.custom_domain::TEXT,
        ca.domain_status::TEXT
    FROM customer_apps ca
    JOIN organizations o ON o.id = ca.organization_id
    WHERE ca.deleted_at IS NULL
    ORDER BY ca.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_all_apps() TO authenticated;
