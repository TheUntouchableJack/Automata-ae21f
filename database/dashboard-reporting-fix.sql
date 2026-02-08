-- =====================================================
-- DASHBOARD REPORTING FIX - 2026-02-05
-- Fixes: app_members.created_at → joined_at
-- Adds: get_org_dashboard_summary for org-wide metrics
-- Run this in Supabase SQL Editor
-- =====================================================

-- =====================================================
-- 1. FIX: GET APP DASHBOARD SUMMARY
-- Fixed: new_this_week now uses joined_at (not created_at)
-- =====================================================

CREATE OR REPLACE FUNCTION get_app_dashboard_summary(p_app_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total_members', (
            SELECT COUNT(*)
            FROM app_members
            WHERE app_id = p_app_id
            AND deleted_at IS NULL
        ),
        'today_checkins', (
            SELECT COUNT(*)
            FROM member_visits
            WHERE app_id = p_app_id
            AND visited_at::date = CURRENT_DATE
        ),
        'new_this_week', (
            SELECT COUNT(*)
            FROM app_members
            WHERE app_id = p_app_id
            AND joined_at > NOW() - INTERVAL '7 days'
            AND deleted_at IS NULL
        ),
        'points_this_week', (
            SELECT COALESCE(SUM(points_change), 0)
            FROM points_transactions
            WHERE app_id = p_app_id
            AND points_change > 0
            AND created_at > NOW() - INTERVAL '7 days'
        ),
        'tier_distribution', (
            SELECT COALESCE(
                jsonb_object_agg(tier, cnt),
                '{}'::jsonb
            )
            FROM (
                SELECT tier, COUNT(*) as cnt
                FROM app_members
                WHERE app_id = p_app_id
                AND deleted_at IS NULL
                GROUP BY tier
            ) sub
        ),
        'active_members_30d', (
            SELECT COUNT(*)
            FROM app_members
            WHERE app_id = p_app_id
            AND last_login_at > NOW() - INTERVAL '30 days'
            AND deleted_at IS NULL
        ),
        'total_visits', (
            SELECT COUNT(*)
            FROM member_visits
            WHERE app_id = p_app_id
        ),
        'referral_count', (
            SELECT COUNT(*)
            FROM app_members
            WHERE app_id = p_app_id
            AND referred_by IS NOT NULL
            AND deleted_at IS NULL
        )
    ) INTO result;

    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 2. FIX: GET MEMBER GROWTH DATA
-- Fixed: all created_at references → joined_at
-- =====================================================

CREATE OR REPLACE FUNCTION get_member_growth(p_app_id UUID, p_days INTEGER DEFAULT 30)
RETURNS TABLE (
    date DATE,
    new_members BIGINT,
    cumulative BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH daily_counts AS (
        SELECT
            DATE(joined_at) as day,
            COUNT(*) as new_count
        FROM app_members
        WHERE app_id = p_app_id
        AND joined_at > NOW() - (p_days || ' days')::INTERVAL
        AND deleted_at IS NULL
        GROUP BY DATE(joined_at)
    ),
    all_days AS (
        SELECT d::date as day
        FROM generate_series(
            (NOW() - (p_days || ' days')::INTERVAL)::date,
            CURRENT_DATE,
            '1 day'::interval
        ) d
    ),
    daily_with_zeros AS (
        SELECT
            ad.day,
            COALESCE(dc.new_count, 0) as new_members
        FROM all_days ad
        LEFT JOIN daily_counts dc ON dc.day = ad.day
    )
    SELECT
        dwz.day as date,
        dwz.new_members,
        SUM(dwz.new_members) OVER (ORDER BY dwz.day) as cumulative
    FROM daily_with_zeros dwz
    ORDER BY dwz.day;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 3. FIX: GET RECENT ACTIVITY
-- Fixed: am.created_at → am.joined_at for member join events
-- =====================================================

CREATE OR REPLACE FUNCTION get_recent_activity(p_app_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
    event_type TEXT,
    member_name TEXT,
    member_id UUID,
    description TEXT,
    points INTEGER,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    (
        -- New members joined
        SELECT
            'member_joined'::TEXT as event_type,
            COALESCE(am.first_name || ' ' || am.last_name, am.email, 'Someone') as member_name,
            am.id as member_id,
            'joined the program'::TEXT as description,
            0 as points,
            am.joined_at as created_at
        FROM app_members am
        WHERE am.app_id = p_app_id
        AND am.deleted_at IS NULL
        AND am.joined_at > NOW() - INTERVAL '7 days'

        UNION ALL

        -- Recent visits
        SELECT
            'visit'::TEXT as event_type,
            COALESCE(am.first_name || ' ' || am.last_name, am.email, 'Someone') as member_name,
            am.id as member_id,
            'checked in'::TEXT as description,
            COALESCE(mv.points_awarded, 0) as points,
            mv.visited_at as created_at
        FROM member_visits mv
        JOIN app_members am ON am.id = mv.member_id
        WHERE mv.app_id = p_app_id
        AND mv.visited_at > NOW() - INTERVAL '7 days'

        UNION ALL

        -- Points transactions (redemptions, bonuses)
        SELECT
            CASE
                WHEN pt.type = 'redeem' THEN 'redemption'
                WHEN pt.type = 'bonus' THEN 'bonus'
                WHEN pt.type = 'referral' THEN 'referral'
                ELSE 'points'
            END as event_type,
            COALESCE(am.first_name || ' ' || am.last_name, am.email, 'Someone') as member_name,
            am.id as member_id,
            pt.description,
            pt.points_change as points,
            pt.created_at
        FROM points_transactions pt
        JOIN app_members am ON am.id = pt.member_id
        WHERE pt.app_id = p_app_id
        AND pt.type IN ('redeem', 'bonus', 'referral')
        AND pt.created_at > NOW() - INTERVAL '7 days'
    )
    ORDER BY created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 4. NEW: GET ORG DASHBOARD SUMMARY
-- Aggregates metrics across ALL apps in an organization
-- =====================================================

CREATE OR REPLACE FUNCTION get_org_dashboard_summary(p_org_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total_members', (
            SELECT COUNT(*)
            FROM app_members am
            JOIN customer_apps ca ON ca.id = am.app_id
            WHERE ca.organization_id = p_org_id
            AND ca.deleted_at IS NULL
            AND am.deleted_at IS NULL
        ),
        'today_checkins', (
            SELECT COUNT(*)
            FROM member_visits mv
            JOIN customer_apps ca ON ca.id = mv.app_id
            WHERE ca.organization_id = p_org_id
            AND ca.deleted_at IS NULL
            AND mv.visited_at::date = CURRENT_DATE
        ),
        'new_this_week', (
            SELECT COUNT(*)
            FROM app_members am
            JOIN customer_apps ca ON ca.id = am.app_id
            WHERE ca.organization_id = p_org_id
            AND ca.deleted_at IS NULL
            AND am.joined_at > NOW() - INTERVAL '7 days'
            AND am.deleted_at IS NULL
        ),
        'points_this_week', (
            SELECT COALESCE(SUM(pt.points_change), 0)
            FROM points_transactions pt
            JOIN customer_apps ca ON ca.id = pt.app_id
            WHERE ca.organization_id = p_org_id
            AND ca.deleted_at IS NULL
            AND pt.points_change > 0
            AND pt.created_at > NOW() - INTERVAL '7 days'
        ),
        'tier_distribution', (
            SELECT COALESCE(
                jsonb_object_agg(tier, cnt),
                '{}'::jsonb
            )
            FROM (
                SELECT am.tier, COUNT(*) as cnt
                FROM app_members am
                JOIN customer_apps ca ON ca.id = am.app_id
                WHERE ca.organization_id = p_org_id
                AND ca.deleted_at IS NULL
                AND am.deleted_at IS NULL
                GROUP BY am.tier
            ) sub
        ),
        'active_members_30d', (
            SELECT COUNT(*)
            FROM app_members am
            JOIN customer_apps ca ON ca.id = am.app_id
            WHERE ca.organization_id = p_org_id
            AND ca.deleted_at IS NULL
            AND am.last_login_at > NOW() - INTERVAL '30 days'
            AND am.deleted_at IS NULL
        ),
        'total_visits', (
            SELECT COUNT(*)
            FROM member_visits mv
            JOIN customer_apps ca ON ca.id = mv.app_id
            WHERE ca.organization_id = p_org_id
            AND ca.deleted_at IS NULL
        ),
        'referral_count', (
            SELECT COUNT(*)
            FROM app_members am
            JOIN customer_apps ca ON ca.id = am.app_id
            WHERE ca.organization_id = p_org_id
            AND ca.deleted_at IS NULL
            AND am.referred_by IS NOT NULL
            AND am.deleted_at IS NULL
        )
    ) INTO result;

    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- DONE! All functions use CREATE OR REPLACE, safe to re-run.
-- =====================================================
