-- Member Limits Enforcement Migration
-- Adds member count checking to customer_app_signup function
-- Run this after customer-app-signup-function.sql and migration_appsumo_plans.sql

-- =====================================================
-- HELPER FUNCTION: Get organization member limit
-- Returns -1 for unlimited, otherwise the numeric limit
-- =====================================================

CREATE OR REPLACE FUNCTION get_org_member_limit(p_org_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_org RECORD;
    v_limit INTEGER;
BEGIN
    SELECT plan_type, appsumo_tier, subscription_tier, plan_limits_override
    INTO v_org
    FROM organizations
    WHERE id = p_org_id;

    IF NOT FOUND THEN
        RETURN 50; -- Default free limit
    END IF;

    -- Check for custom override first
    IF v_org.plan_limits_override IS NOT NULL AND v_org.plan_limits_override ? 'members' THEN
        RETURN (v_org.plan_limits_override->>'members')::INTEGER;
    END IF;

    -- Return limit based on plan type
    CASE v_org.plan_type
        WHEN 'appsumo_lifetime' THEN
            CASE v_org.appsumo_tier
                WHEN 1 THEN RETURN 500;
                WHEN 2 THEN RETURN 2000;
                WHEN 3 THEN RETURN -1; -- unlimited
                ELSE RETURN 500;
            END CASE;
        WHEN 'subscription' THEN
            CASE v_org.subscription_tier
                WHEN 'starter' THEN RETURN 500;
                WHEN 'growth' THEN RETURN 2000;
                WHEN 'scale' THEN RETURN -1; -- unlimited
                ELSE RETURN 500;
            END CASE;
        ELSE
            RETURN 50; -- free tier
    END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- HELPER FUNCTION: Count current members for an org
-- Counts across all apps in the organization
-- =====================================================

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

-- =====================================================
-- HELPER FUNCTION: Check if org can add more members
-- Returns: { allowed: boolean, current: integer, limit: integer }
-- =====================================================

CREATE OR REPLACE FUNCTION check_member_limit(p_org_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_limit INTEGER;
    v_current INTEGER;
BEGIN
    v_limit := get_org_member_limit(p_org_id);
    v_current := count_org_members(p_org_id);

    -- Unlimited
    IF v_limit = -1 THEN
        RETURN jsonb_build_object('allowed', true, 'current', v_current, 'limit', -1);
    END IF;

    -- At or over limit
    IF v_current >= v_limit THEN
        RETURN jsonb_build_object('allowed', false, 'current', v_current, 'limit', v_limit);
    END IF;

    -- Under limit
    RETURN jsonb_build_object('allowed', true, 'current', v_current, 'limit', v_limit);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_org_member_limit(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION count_org_members(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_member_limit(UUID) TO anon, authenticated;

-- =====================================================
-- UPDATE customer_app_signup WITH MEMBER LIMIT CHECK
-- =====================================================

-- Drop and recreate with limit checking
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
    WHERE id = p_app_id
      AND is_published = true
      AND is_active = true
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'App not found or not published'::TEXT;
        RETURN;
    END IF;

    -- ===== MEMBER LIMIT CHECK =====
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
    -- ===== END LIMIT CHECK =====

    -- Check for existing member with this email
    SELECT id INTO v_existing_member
    FROM app_members
    WHERE app_id = p_app_id AND email = lower(p_email) AND deleted_at IS NULL;

    IF FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'Email already registered. Please log in instead.'::TEXT;
        RETURN;
    END IF;

    -- Check for existing member with this phone (if phone provided)
    IF p_phone IS NOT NULL AND p_phone != '' THEN
        SELECT id INTO v_existing_member
        FROM app_members
        WHERE app_id = p_app_id AND phone = p_phone AND deleted_at IS NULL;

        IF FOUND THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'Phone number already registered. Please use a different number or log in.'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- Get welcome points from settings
    v_welcome_points := COALESCE((v_app.settings->>'welcome_points')::INTEGER, 50);

    -- Create customer record in org's customers table
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
    RETURNING id INTO v_customer_id;

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
    RETURNING id INTO v_member_id;

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
        -- Check what constraint was violated
        IF SQLERRM LIKE '%phone%' THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'Phone number already registered. Please use a different number or log in.'::TEXT;
        ELSE
            RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'Email already registered. Please log in instead.'::TEXT;
        END IF;
    WHEN OTHERS THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, ('Signup failed: ' || SQLERRM)::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to anon users (for signup from customer app)
GRANT EXECUTE ON FUNCTION customer_app_signup(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- =====================================================
-- VERIFY
-- =====================================================
SELECT 'Member limits enforcement migration complete' as status;
