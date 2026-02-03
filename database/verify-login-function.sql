-- =====================================================
-- VERIFY APP MEMBER LOGIN FUNCTION
-- Run this in Supabase SQL Editor
-- Securely verifies member login server-side
-- =====================================================

-- Drop any existing versions first (handles signature conflicts)
DROP FUNCTION IF EXISTS verify_app_member_login(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS verify_app_member_login(UUID, TEXT, TEXT, TEXT);

-- Function to verify member login (server-side PIN check)
-- This prevents exposing PIN hashes to the client
-- Rate limited: 5 attempts per 15 minutes per email/phone per app
CREATE OR REPLACE FUNCTION verify_app_member_login(
    p_app_id UUID,
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_pin_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_member app_members%ROWTYPE;
    v_app customer_apps%ROWTYPE;
    v_identifier TEXT;
    v_is_allowed BOOLEAN;
BEGIN
    -- Validate input: need either email or phone
    IF p_email IS NULL AND p_phone IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Email or phone required'
        );
    END IF;

    -- Validate PIN hash provided
    IF p_pin_hash IS NULL OR LENGTH(p_pin_hash) < 10 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Invalid PIN'
        );
    END IF;

    -- Build identifier for rate limiting (app_id + email/phone)
    v_identifier := p_app_id::TEXT || ':' || COALESCE(LOWER(p_email), p_phone);

    -- Check rate limit: 5 attempts per 15 minutes
    v_is_allowed := check_and_record_rate_limit(v_identifier, 'member_login', 5, 15);

    IF NOT v_is_allowed THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Too many login attempts. Please try again in 15 minutes.',
            'rate_limited', true
        );
    END IF;

    -- Check app exists and is active
    SELECT * INTO v_app
    FROM customer_apps
    WHERE id = p_app_id
      AND is_active = true
      AND deleted_at IS NULL;

    IF v_app.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'App not found or inactive'
        );
    END IF;

    -- Find member by email or phone
    IF p_email IS NOT NULL THEN
        SELECT * INTO v_member
        FROM app_members
        WHERE app_id = p_app_id
          AND LOWER(email) = LOWER(p_email)
          AND deleted_at IS NULL;
    ELSE
        SELECT * INTO v_member
        FROM app_members
        WHERE app_id = p_app_id
          AND phone = p_phone
          AND deleted_at IS NULL;
    END IF;

    -- Member not found - use generic error (don't reveal account existence)
    IF v_member.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Invalid credentials'
        );
    END IF;

    -- Verify PIN hash matches
    IF v_member.pin_hash != p_pin_hash THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Invalid credentials'
        );
    END IF;

    -- Success! Update last_login_at
    UPDATE app_members
    SET last_login_at = NOW()
    WHERE id = v_member.id;

    RETURN jsonb_build_object(
        'success', true,
        'member_id', v_member.id,
        'display_name', v_member.display_name,
        'tier', v_member.tier,
        'points_balance', v_member.points_balance
    );
END;
$$;

-- Grant execute to anon (public login from customer app)
GRANT EXECUTE ON FUNCTION verify_app_member_login(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;

-- Add comment
COMMENT ON FUNCTION verify_app_member_login IS 'Securely verify member login with server-side PIN check. Rate limited to 5 attempts per 15 minutes. Returns member info on success.';
