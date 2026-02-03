-- =====================================================
-- PREVIEW APP FUNCTION
-- Run this in Supabase SQL Editor
-- Allows previewing unpublished apps by ID (for owners)
-- =====================================================

-- Function to get app by ID for preview (doesn't require is_published = true)
-- This is used in the app builder to preview apps before publishing
CREATE OR REPLACE FUNCTION preview_app_by_id(p_app_id UUID)
RETURNS TABLE (
    id UUID,
    organization_id UUID,
    name TEXT,
    slug TEXT,
    description TEXT,
    app_type TEXT,
    branding JSONB,
    features JSONB,
    settings JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ca.id,
        ca.organization_id,
        ca.name::TEXT,
        ca.slug::TEXT,
        ca.description::TEXT,
        ca.app_type::TEXT,
        ca.branding,
        ca.features,
        -- Only return safe settings for public preview
        jsonb_build_object(
            'welcome_points', ca.settings->'welcome_points',
            'tier_thresholds', ca.settings->'tier_thresholds',
            'require_email', ca.settings->'require_email',
            'require_phone', ca.settings->'require_phone'
        ) as settings
    FROM customer_apps ca
    WHERE ca.id = p_app_id
      AND ca.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to both anon and authenticated
-- Note: The preview URL will include the app_id which acts as a secret token
-- In production, consider adding authentication checks
GRANT EXECUTE ON FUNCTION preview_app_by_id(UUID) TO anon, authenticated;
