-- Ensure customer_app_signup, get_app_by_slug, and member limit helpers exist.
-- These were only applied via SQL Editor, never as migrations.
-- Without them, customer-facing app signup fails.

-- =====================================================
-- 1. get_app_by_slug
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
    settings JSONB
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
        ) as settings
    FROM customer_apps ca
    WHERE ca.slug = p_slug
      AND ca.is_published = true
      AND ca.is_active = true
      AND ca.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_app_by_slug(TEXT) TO anon, authenticated;

-- =====================================================
-- 2. Member limit helper functions
-- =====================================================

CREATE OR REPLACE FUNCTION get_org_member_limit(p_org_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_org RECORD;
BEGIN
    SELECT plan_type, appsumo_tier, subscription_tier, plan_limits_override
    INTO v_org
    FROM organizations
    WHERE id = p_org_id;

    IF NOT FOUND THEN
        RETURN 50;
    END IF;

    IF v_org.plan_limits_override IS NOT NULL AND v_org.plan_limits_override ? 'members' THEN
        RETURN (v_org.plan_limits_override->>'members')::INTEGER;
    END IF;

    CASE v_org.plan_type
        WHEN 'appsumo_lifetime' THEN
            CASE v_org.appsumo_tier
                WHEN 1 THEN RETURN 500;
                WHEN 2 THEN RETURN 2000;
                WHEN 3 THEN RETURN -1;
                ELSE RETURN 500;
            END CASE;
        WHEN 'subscription' THEN
            CASE v_org.subscription_tier
                WHEN 'starter' THEN RETURN 500;
                WHEN 'growth' THEN RETURN 2000;
                WHEN 'scale' THEN RETURN -1;
                ELSE RETURN 500;
            END CASE;
        ELSE
            RETURN 50;
    END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION count_org_members(p_org_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM app_members am
    JOIN customer_apps ca ON am.app_id = ca.id
    WHERE ca.organization_id = p_org_id
      AND am.deleted_at IS NULL;
    RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION check_member_limit(p_org_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_limit INTEGER;
    v_current INTEGER;
BEGIN
    v_limit := get_org_member_limit(p_org_id);
    v_current := count_org_members(p_org_id);

    IF v_limit = -1 THEN
        RETURN jsonb_build_object('allowed', true, 'current', v_current, 'limit', -1);
    END IF;

    IF v_current >= v_limit THEN
        RETURN jsonb_build_object('allowed', false, 'current', v_current, 'limit', v_limit);
    END IF;

    RETURN jsonb_build_object('allowed', true, 'current', v_current, 'limit', v_limit);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_org_member_limit(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION count_org_members(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_member_limit(UUID) TO anon, authenticated;

-- =====================================================
-- 3. customer_app_signup (with member limit check)
-- =====================================================

-- Drop existing — return type may have changed
DROP FUNCTION IF EXISTS customer_app_signup(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION customer_app_signup(
    p_app_id UUID,
    p_first_name TEXT,
    p_last_name TEXT,
    p_email TEXT,
    p_phone TEXT DEFAULT NULL,
    p_pin_hash TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    member_id UUID,
    customer_id UUID,
    welcome_points INTEGER,
    error_message TEXT
) AS $$
DECLARE
    v_app RECORD;
    v_customer_id UUID;
    v_member_id UUID;
    v_welcome_points INTEGER;
    v_existing_member UUID;
    v_limit_check JSONB;
BEGIN
    -- Get app and validate
    SELECT * INTO v_app
    FROM customer_apps
    WHERE customer_apps.id = p_app_id
      AND is_published = true
      AND is_active = true
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'App not found or not published'::TEXT;
        RETURN;
    END IF;

    -- Member limit check
    v_limit_check := check_member_limit(v_app.organization_id);

    IF NOT (v_limit_check->>'allowed')::BOOLEAN THEN
        RETURN QUERY SELECT
            false,
            NULL::UUID,
            NULL::UUID,
            NULL::INTEGER,
            format('This loyalty program has reached its member limit (%s members). Please contact the business owner.', (v_limit_check->>'limit')::TEXT)::TEXT;
        RETURN;
    END IF;

    -- Check for existing member with this email
    SELECT app_members.id INTO v_existing_member
    FROM app_members
    WHERE app_id = p_app_id AND email = lower(p_email) AND deleted_at IS NULL;

    IF FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'Email already registered. Please log in instead.'::TEXT;
        RETURN;
    END IF;

    -- Check for existing member with this phone (if phone provided)
    IF p_phone IS NOT NULL AND p_phone != '' THEN
        SELECT app_members.id INTO v_existing_member
        FROM app_members
        WHERE app_id = p_app_id AND phone = p_phone AND deleted_at IS NULL;

        IF FOUND THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'Phone number already registered. Please use a different number or log in.'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- Get welcome points from settings
    v_welcome_points := COALESCE((v_app.settings->>'welcome_points')::INTEGER, 50);

    -- Create customer record
    INSERT INTO customers (
        organization_id,
        first_name,
        last_name,
        email,
        phone,
        source,
        tags
    ) VALUES (
        v_app.organization_id,
        p_first_name,
        p_last_name,
        lower(p_email),
        p_phone,
        'app',
        ARRAY['app-member']
    )
    RETURNING customers.id INTO v_customer_id;

    -- Create app member record
    INSERT INTO app_members (
        app_id,
        customer_id,
        first_name,
        last_name,
        email,
        phone,
        display_name,
        pin_hash,
        points_balance,
        total_points_earned,
        tier,
        profile_public,
        notifications_enabled
    ) VALUES (
        p_app_id,
        v_customer_id,
        p_first_name,
        p_last_name,
        lower(p_email),
        p_phone,
        p_first_name,
        p_pin_hash,
        v_welcome_points,
        v_welcome_points,
        'bronze',
        false,
        true
    )
    RETURNING app_members.id INTO v_member_id;

    -- Create welcome points transaction
    INSERT INTO points_transactions (
        app_id,
        member_id,
        type,
        points_change,
        balance_after,
        description
    ) VALUES (
        p_app_id,
        v_member_id,
        'welcome',
        v_welcome_points,
        v_welcome_points,
        'Welcome bonus'
    );

    -- Create member_joined event
    INSERT INTO app_events (
        app_id,
        member_id,
        event_type,
        event_data
    ) VALUES (
        p_app_id,
        v_member_id,
        'member_joined',
        jsonb_build_object(
            'first_name', p_first_name,
            'email', lower(p_email),
            'welcome_points', v_welcome_points
        )
    );

    RETURN QUERY SELECT true, v_member_id, v_customer_id, v_welcome_points, NULL::TEXT;

EXCEPTION
    WHEN unique_violation THEN
        IF SQLERRM LIKE '%phone%' THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'Phone number already registered. Please use a different number or log in.'::TEXT;
        ELSE
            RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'Email already registered. Please log in instead.'::TEXT;
        END IF;
    WHEN OTHERS THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, ('Signup failed: ' || SQLERRM)::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION customer_app_signup(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
