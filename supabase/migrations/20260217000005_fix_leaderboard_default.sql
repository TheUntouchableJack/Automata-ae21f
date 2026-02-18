-- =====================================================
-- Fix leaderboard: default profile_public to true, update existing members,
-- and add id + joined_at to get_app_leaderboard return type
-- =====================================================

-- 1. Update existing members who have profile_public = false
UPDATE app_members SET profile_public = true WHERE profile_public = false AND deleted_at IS NULL;

-- 2. Update customer_app_signup to default profile_public to true
-- Must drop first because return type may differ from existing version
DROP FUNCTION IF EXISTS customer_app_signup(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION customer_app_signup(
    p_app_id UUID,
    p_first_name TEXT,
    p_last_name TEXT,
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_pin TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    member_id UUID,
    error_message TEXT,
    welcome_points INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_member_id UUID;
    v_customer_id UUID;
    v_welcome_points INTEGER := 0;
    v_pin_hash TEXT;
    v_app_settings JSONB;
BEGIN
    -- Validate app exists and is active
    SELECT settings INTO v_app_settings
    FROM customer_apps
    WHERE id = p_app_id AND is_active = true AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, 'App not found or inactive'::TEXT, 0;
        RETURN;
    END IF;

    -- Check for existing member with same email or phone
    IF p_email IS NOT NULL THEN
        SELECT id INTO v_member_id
        FROM app_members
        WHERE app_id = p_app_id AND lower(email) = lower(p_email) AND deleted_at IS NULL;

        IF v_member_id IS NOT NULL THEN
            RETURN QUERY SELECT false, NULL::UUID, 'An account with this email already exists'::TEXT, 0;
            RETURN;
        END IF;
    END IF;

    IF p_phone IS NOT NULL THEN
        SELECT id INTO v_member_id
        FROM app_members
        WHERE app_id = p_app_id AND phone = p_phone AND deleted_at IS NULL;

        IF v_member_id IS NOT NULL THEN
            RETURN QUERY SELECT false, NULL::UUID, 'An account with this phone number already exists'::TEXT, 0;
            RETURN;
        END IF;
    END IF;

    -- Get welcome points from app settings
    v_welcome_points := COALESCE((v_app_settings->>'welcome_points')::INTEGER, 0);

    -- Hash the PIN server-side
    IF p_pin IS NOT NULL AND p_pin != '' THEN
        v_pin_hash := crypt(p_pin, gen_salt('bf'));
    END IF;

    -- Find or create customer record
    IF p_email IS NOT NULL THEN
        SELECT id INTO v_customer_id
        FROM customers
        WHERE lower(email) = lower(p_email)
        LIMIT 1;
    END IF;

    IF v_customer_id IS NULL AND p_phone IS NOT NULL THEN
        SELECT id INTO v_customer_id
        FROM customers
        WHERE phone = p_phone
        LIMIT 1;
    END IF;

    IF v_customer_id IS NULL THEN
        INSERT INTO customers (first_name, last_name, email, phone, organization_id)
        SELECT p_first_name, p_last_name, lower(p_email), p_phone, ca.organization_id
        FROM customer_apps ca WHERE ca.id = p_app_id
        RETURNING id INTO v_customer_id;
    END IF;

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
        v_pin_hash,
        v_welcome_points,
        v_welcome_points,
        'bronze',
        true,  -- Default to public so members appear on leaderboard
        true
    )
    RETURNING id INTO v_member_id;

    -- Record welcome points transaction if applicable
    IF v_welcome_points > 0 THEN
        INSERT INTO points_transactions (member_id, type, points_change, balance_after, description)
        VALUES (v_member_id, 'welcome', v_welcome_points, v_welcome_points, 'Welcome bonus points');
    END IF;

    RETURN QUERY SELECT true, v_member_id, NULL::TEXT, v_welcome_points;
END;
$$;

GRANT EXECUTE ON FUNCTION customer_app_signup(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- 3. Update get_app_leaderboard to return id and joined_at (for profile clicks)
-- Must drop first because return type changed (added id, joined_at columns)
DROP FUNCTION IF EXISTS get_app_leaderboard(UUID, INTEGER);
CREATE OR REPLACE FUNCTION get_app_leaderboard(p_app_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
    id UUID,
    rank BIGINT,
    display_name TEXT,
    avatar_url TEXT,
    points_balance INTEGER,
    tier TEXT,
    joined_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        am.id,
        ROW_NUMBER() OVER (ORDER BY am.points_balance DESC) as rank,
        COALESCE(am.display_name, am.first_name, 'Anonymous') as display_name,
        am.avatar_url,
        am.points_balance,
        am.tier,
        am.joined_at
    FROM app_members am
    WHERE am.app_id = p_app_id
      AND am.profile_public = true
      AND am.deleted_at IS NULL
    ORDER BY am.points_balance DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_app_leaderboard(UUID, INTEGER) TO anon, authenticated;
