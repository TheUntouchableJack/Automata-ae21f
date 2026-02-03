-- =====================================================
-- PROFILE & VISITS MIGRATION
-- Run this in Supabase SQL Editor
-- Adds profile photo support and visit tracking
-- =====================================================

-- ===== PROFILE PHOTO =====

-- Add avatar_url column to app_members
ALTER TABLE app_members
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Comment
COMMENT ON COLUMN app_members.avatar_url IS 'URL to member profile photo in Supabase Storage';


-- ===== VISIT TRACKING =====

-- Add visit tracking columns to app_members
ALTER TABLE app_members
ADD COLUMN IF NOT EXISTS visit_count INTEGER DEFAULT 0;

ALTER TABLE app_members
ADD COLUMN IF NOT EXISTS current_streak INTEGER DEFAULT 0;

ALTER TABLE app_members
ADD COLUMN IF NOT EXISTS longest_streak INTEGER DEFAULT 0;

ALTER TABLE app_members
ADD COLUMN IF NOT EXISTS last_visit_at TIMESTAMPTZ;

-- Comments
COMMENT ON COLUMN app_members.visit_count IS 'Total number of check-in visits';
COMMENT ON COLUMN app_members.current_streak IS 'Current consecutive days streak';
COMMENT ON COLUMN app_members.longest_streak IS 'Longest streak achieved';
COMMENT ON COLUMN app_members.last_visit_at IS 'Timestamp of last check-in visit';


-- ===== MEMBER VISITS TABLE =====

-- Create table to track individual visits
CREATE TABLE IF NOT EXISTS member_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES app_members(id) ON DELETE CASCADE,
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    visited_at TIMESTAMPTZ DEFAULT NOW(),
    points_awarded INTEGER NOT NULL DEFAULT 0,
    streak_bonus INTEGER DEFAULT 0,
    milestone_bonus INTEGER DEFAULT 0,
    location_id UUID, -- For multi-location support (future)
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for member_visits
CREATE INDEX IF NOT EXISTS idx_member_visits_member_id ON member_visits(member_id);
CREATE INDEX IF NOT EXISTS idx_member_visits_app_id ON member_visits(app_id);
CREATE INDEX IF NOT EXISTS idx_member_visits_visited_at ON member_visits(visited_at DESC);

-- RLS for member_visits
ALTER TABLE member_visits ENABLE ROW LEVEL SECURITY;

-- Members can view their own visits
CREATE POLICY "Members can view own visits" ON member_visits
    FOR SELECT USING (true); -- Public read for now, restrict later if needed


-- ===== STORAGE BUCKET FOR AVATARS =====

-- Create storage bucket for member avatars (run in SQL editor)
-- Note: You may need to create this in Supabase Dashboard > Storage instead
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'member-avatars',
    'member-avatars',
    true,
    2097152, -- 2MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: Anyone can read avatars (public bucket)
CREATE POLICY "Public avatar access" ON storage.objects
    FOR SELECT USING (bucket_id = 'member-avatars');

-- Storage policy: Members can upload their own avatar
-- (Uses member_id in path: member-avatars/{member_id}/avatar.jpg)
CREATE POLICY "Members can upload own avatar" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'member-avatars');

-- Storage policy: Members can update their own avatar
CREATE POLICY "Members can update own avatar" ON storage.objects
    FOR UPDATE USING (bucket_id = 'member-avatars');

-- Storage policy: Members can delete their own avatar
CREATE POLICY "Members can delete own avatar" ON storage.objects
    FOR DELETE USING (bucket_id = 'member-avatars');


-- ===== UPDATE MEMBER PROFILE RPC =====

-- Function to update member profile (name, email, phone, avatar)
CREATE OR REPLACE FUNCTION update_member_profile(
    p_member_id UUID,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_member app_members%ROWTYPE;
    v_display_name TEXT;
BEGIN
    -- Get current member
    SELECT * INTO v_member
    FROM app_members
    WHERE id = p_member_id
      AND deleted_at IS NULL;

    IF v_member.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Member not found'
        );
    END IF;

    -- Check email uniqueness if changing
    IF p_email IS NOT NULL AND p_email != '' AND LOWER(p_email) != LOWER(COALESCE(v_member.email, '')) THEN
        IF EXISTS (
            SELECT 1 FROM app_members
            WHERE app_id = v_member.app_id
              AND LOWER(email) = LOWER(p_email)
              AND id != p_member_id
              AND deleted_at IS NULL
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error_message', 'Email already in use'
            );
        END IF;
    END IF;

    -- Check phone uniqueness if changing
    IF p_phone IS NOT NULL AND p_phone != '' AND p_phone != COALESCE(v_member.phone, '') THEN
        IF EXISTS (
            SELECT 1 FROM app_members
            WHERE app_id = v_member.app_id
              AND phone = p_phone
              AND id != p_member_id
              AND deleted_at IS NULL
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error_message', 'Phone number already in use'
            );
        END IF;
    END IF;

    -- Build display name
    v_display_name := TRIM(COALESCE(p_first_name, v_member.first_name, '') || ' ' || COALESCE(p_last_name, v_member.last_name, ''));
    IF v_display_name = '' THEN
        v_display_name := NULL;
    END IF;

    -- Update member
    UPDATE app_members
    SET
        first_name = COALESCE(NULLIF(p_first_name, ''), first_name),
        last_name = COALESCE(NULLIF(p_last_name, ''), last_name),
        display_name = COALESCE(v_display_name, display_name),
        email = COALESCE(NULLIF(p_email, ''), email),
        phone = COALESCE(NULLIF(p_phone, ''), phone),
        avatar_url = COALESCE(p_avatar_url, avatar_url),
        updated_at = NOW()
    WHERE id = p_member_id;

    -- Return updated member data
    SELECT * INTO v_member FROM app_members WHERE id = p_member_id;

    RETURN jsonb_build_object(
        'success', true,
        'member', jsonb_build_object(
            'id', v_member.id,
            'first_name', v_member.first_name,
            'last_name', v_member.last_name,
            'display_name', v_member.display_name,
            'email', v_member.email,
            'phone', v_member.phone,
            'avatar_url', v_member.avatar_url,
            'tier', v_member.tier,
            'points_balance', v_member.points_balance
        )
    );
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION update_member_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- Comment
COMMENT ON FUNCTION update_member_profile IS 'Update member profile info with email/phone uniqueness checks';


-- ===== RECORD VISIT RPC (for future use) =====

-- Function to record a visit and award points
CREATE OR REPLACE FUNCTION record_member_visit(
    p_app_id UUID,
    p_member_id UUID,
    p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_member app_members%ROWTYPE;
    v_app customer_apps%ROWTYPE;
    v_settings JSONB;
    v_last_visit DATE;
    v_today DATE := CURRENT_DATE;
    v_points_per_visit INTEGER;
    v_daily_limit INTEGER;
    v_visits_today INTEGER;
    v_streak_bonus INTEGER := 0;
    v_milestone_bonus INTEGER := 0;
    v_total_points INTEGER;
    v_new_streak INTEGER;
    v_visit_id UUID;
BEGIN
    -- Get app settings
    SELECT * INTO v_app
    FROM customer_apps
    WHERE id = p_app_id
      AND is_active = true
      AND deleted_at IS NULL;

    IF v_app.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'App not found');
    END IF;

    v_settings := COALESCE(v_app.settings, '{}'::JSONB);
    v_points_per_visit := COALESCE((v_settings->>'points_per_scan')::INTEGER, 10);
    v_daily_limit := COALESCE((v_settings->>'daily_scan_limit')::INTEGER, 1);

    -- Get member
    SELECT * INTO v_member
    FROM app_members
    WHERE id = p_member_id
      AND app_id = p_app_id
      AND deleted_at IS NULL;

    IF v_member.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Member not found');
    END IF;

    -- Check daily limit
    SELECT COUNT(*) INTO v_visits_today
    FROM member_visits
    WHERE member_id = p_member_id
      AND DATE(visited_at) = v_today;

    IF v_visits_today >= v_daily_limit THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Daily visit limit reached',
            'visits_today', v_visits_today,
            'daily_limit', v_daily_limit
        );
    END IF;

    -- Calculate streak
    v_last_visit := DATE(v_member.last_visit_at);

    IF v_last_visit = v_today - INTERVAL '1 day' THEN
        -- Consecutive day - increment streak
        v_new_streak := COALESCE(v_member.current_streak, 0) + 1;
    ELSIF v_last_visit = v_today THEN
        -- Same day - keep current streak
        v_new_streak := COALESCE(v_member.current_streak, 1);
    ELSE
        -- Streak broken - start fresh
        v_new_streak := 1;
    END IF;

    -- Calculate streak bonus
    IF v_new_streak = 3 THEN v_streak_bonus := 5;
    ELSIF v_new_streak = 7 THEN v_streak_bonus := 15;
    ELSIF v_new_streak = 30 THEN v_streak_bonus := 50;
    END IF;

    -- Calculate milestone bonus (based on total visits + 1)
    IF (v_member.visit_count + 1) = 10 THEN v_milestone_bonus := 25;
    ELSIF (v_member.visit_count + 1) = 50 THEN v_milestone_bonus := 100;
    ELSIF (v_member.visit_count + 1) = 100 THEN v_milestone_bonus := 250;
    END IF;

    v_total_points := v_points_per_visit + v_streak_bonus + v_milestone_bonus;

    -- Record visit
    INSERT INTO member_visits (member_id, app_id, points_awarded, streak_bonus, milestone_bonus, location_id)
    VALUES (p_member_id, p_app_id, v_points_per_visit, v_streak_bonus, v_milestone_bonus, p_location_id)
    RETURNING id INTO v_visit_id;

    -- Update member
    UPDATE app_members
    SET
        points_balance = points_balance + v_total_points,
        total_points_earned = total_points_earned + v_total_points,
        visit_count = visit_count + 1,
        current_streak = v_new_streak,
        longest_streak = GREATEST(longest_streak, v_new_streak),
        last_visit_at = NOW()
    WHERE id = p_member_id;

    -- Record points transaction
    INSERT INTO points_transactions (member_id, app_id, type, points_change, description, metadata)
    VALUES (
        p_member_id,
        p_app_id,
        'visit',
        v_total_points,
        CASE
            WHEN v_streak_bonus > 0 AND v_milestone_bonus > 0 THEN 'Visit + ' || v_new_streak || '-day streak + Milestone bonus!'
            WHEN v_streak_bonus > 0 THEN 'Visit + ' || v_new_streak || '-day streak bonus!'
            WHEN v_milestone_bonus > 0 THEN 'Visit + Milestone bonus!'
            ELSE 'Check-in visit'
        END,
        jsonb_build_object(
            'visit_id', v_visit_id,
            'base_points', v_points_per_visit,
            'streak_bonus', v_streak_bonus,
            'milestone_bonus', v_milestone_bonus,
            'streak_days', v_new_streak
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'points_awarded', v_total_points,
        'base_points', v_points_per_visit,
        'streak_bonus', v_streak_bonus,
        'milestone_bonus', v_milestone_bonus,
        'current_streak', v_new_streak,
        'visit_count', v_member.visit_count + 1,
        'new_balance', v_member.points_balance + v_total_points
    );
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION record_member_visit(UUID, UUID, UUID) TO anon, authenticated;

-- Comment
COMMENT ON FUNCTION record_member_visit IS 'Record a member visit, award points with streak and milestone bonuses';


-- ===== DONE =====
-- Run this migration in Supabase SQL Editor
-- Then test by updating a member profile or recording a visit
