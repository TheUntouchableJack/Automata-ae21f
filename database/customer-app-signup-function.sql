-- =====================================================
-- CUSTOMER APP SIGNUP FUNCTION
-- Run this in Supabase SQL Editor
-- Creates atomic signup function for customer app
-- =====================================================

-- Drop existing function first (return type changed)
DROP FUNCTION IF EXISTS get_app_by_slug(TEXT);

-- Update get_app_by_slug to include organization_id
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

-- Function to handle customer app signup atomically
-- Creates: customer + app_member + points_transaction + app_event
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

-- Verify function was created
SELECT 'customer_app_signup function created successfully' as status;
