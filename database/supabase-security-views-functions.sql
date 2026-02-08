-- =====================================================
-- SUPABASE SECURITY VIEWS & FUNCTIONS MIGRATION
-- Fixes Supabase linter security issues for the Royalty project
--
-- Section A: Recreate views with security_invoker = on
-- Section B: SECURITY DEFINER functions with SET search_path = ''
-- Section C: Change specific functions to SECURITY INVOKER
--
-- Run this in Supabase SQL Editor
-- =====================================================


-- #####################################################
-- SECTION A: VIEWS (security_invoker = on)
-- #####################################################

-- Drop views in reverse dependency order
DROP VIEW IF EXISTS recoverable_items;
DROP VIEW IF EXISTS active_project_customers;
DROP VIEW IF EXISTS active_blog_posts;
DROP VIEW IF EXISTS active_customers;
DROP VIEW IF EXISTS active_automations;
DROP VIEW IF EXISTS active_projects;

-- Recreate with security_invoker = on

CREATE OR REPLACE VIEW active_projects
WITH (security_invoker = on)
AS
SELECT * FROM projects WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_automations
WITH (security_invoker = on)
AS
SELECT * FROM automations WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_customers
WITH (security_invoker = on)
AS
SELECT * FROM customers WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_blog_posts
WITH (security_invoker = on)
AS
SELECT * FROM blog_posts WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_project_customers
WITH (security_invoker = on)
AS
SELECT * FROM project_customers WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW recoverable_items
WITH (security_invoker = on)
AS
SELECT
    'project' as entity_type,
    id as entity_id,
    name as entity_name,
    deleted_at,
    deleted_by,
    organization_id
FROM projects
WHERE deleted_at IS NOT NULL
  AND deleted_at > NOW() - INTERVAL '1 hour'

UNION ALL

SELECT
    'automation' as entity_type,
    a.id as entity_id,
    a.name as entity_name,
    a.deleted_at,
    a.deleted_by,
    p.organization_id
FROM automations a
JOIN projects p ON a.project_id = p.id
WHERE a.deleted_at IS NOT NULL
  AND a.deleted_at > NOW() - INTERVAL '1 hour'

UNION ALL

SELECT
    'customer' as entity_type,
    id as entity_id,
    COALESCE(first_name || ' ' || last_name, email, 'Customer') as entity_name,
    deleted_at,
    deleted_by,
    organization_id
FROM customers
WHERE deleted_at IS NOT NULL
  AND deleted_at > NOW() - INTERVAL '1 hour'

UNION ALL

SELECT
    'blog_post' as entity_type,
    bp.id as entity_id,
    bp.title as entity_name,
    bp.deleted_at,
    bp.deleted_by,
    p.organization_id
FROM blog_posts bp
JOIN automations a ON bp.automation_id = a.id
JOIN projects p ON a.project_id = p.id
WHERE bp.deleted_at IS NOT NULL
  AND bp.deleted_at > NOW() - INTERVAL '1 hour';


-- #####################################################
-- SECTION B: SECURITY DEFINER FUNCTIONS
-- (Keep DEFINER, add SET search_path = '', prefix tables with public.)
-- #####################################################

-- =====================================================
-- B1. handle_new_user() - from schema.sql
-- Trigger function - no GRANT needed
-- =====================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    new_org_id UUID;
    user_first_name TEXT;
    user_last_name TEXT;
    org_name TEXT;
    org_slug TEXT;
BEGIN
    -- Get user names
    user_first_name := NEW.raw_user_meta_data->>'first_name';
    user_last_name := NEW.raw_user_meta_data->>'last_name';

    -- Create profile
    INSERT INTO public.profiles (id, email, first_name, last_name)
    VALUES (
        NEW.id,
        NEW.email,
        user_first_name,
        user_last_name
    );

    -- Create default organization for user
    org_name := COALESCE(user_first_name || '''s Organization', 'My Organization');
    org_slug := LOWER(REPLACE(NEW.email, '@', '-at-') || '-' || SUBSTRING(NEW.id::TEXT, 1, 8));

    INSERT INTO public.organizations (id, name, slug)
    VALUES (gen_random_uuid(), org_name, org_slug)
    RETURNING id INTO new_org_id;

    -- Add user as owner of their organization
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (new_org_id, NEW.id, 'owner');

    RETURN NEW;
END;
$$;

-- =====================================================
-- B2. notify_feature_request() - from schema.sql
-- Trigger function - no GRANT needed
-- =====================================================

CREATE OR REPLACE FUNCTION notify_feature_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    webhook_url TEXT;
    payload JSONB;
    submitter_email TEXT;
BEGIN
    -- Get webhook URL from settings
    SELECT value::text INTO webhook_url
    FROM public.app_settings
    WHERE key = 'notification_webhook_url';

    -- Remove quotes from JSON string
    webhook_url := TRIM(BOTH '"' FROM webhook_url);

    -- Skip if no webhook configured
    IF webhook_url IS NULL OR webhook_url = '' THEN
        RETURN NEW;
    END IF;

    -- Get submitter email if available
    IF NEW.submitted_by IS NOT NULL THEN
        SELECT email INTO submitter_email FROM public.profiles WHERE id = NEW.submitted_by;
    ELSE
        submitter_email := NEW.email;
    END IF;

    -- Build payload (Slack-compatible format)
    payload := jsonb_build_object(
        'text', '🚀 *New Feature Request*',
        'blocks', jsonb_build_array(
            jsonb_build_object(
                'type', 'header',
                'text', jsonb_build_object(
                    'type', 'plain_text',
                    'text', '🚀 New Feature Request'
                )
            ),
            jsonb_build_object(
                'type', 'section',
                'fields', jsonb_build_array(
                    jsonb_build_object('type', 'mrkdwn', 'text', '*Title:*\n' || NEW.title),
                    jsonb_build_object('type', 'mrkdwn', 'text', '*Category:*\n' || COALESCE(NEW.category, 'feature'))
                )
            ),
            jsonb_build_object(
                'type', 'section',
                'text', jsonb_build_object(
                    'type', 'mrkdwn',
                    'text', '*Description:*\n' || COALESCE(NEW.description, '_No description provided_')
                )
            ),
            jsonb_build_object(
                'type', 'context',
                'elements', jsonb_build_array(
                    jsonb_build_object('type', 'mrkdwn', 'text', '📧 From: ' || COALESCE(submitter_email, '_Anonymous_'))
                )
            )
        )
    );

    -- Send webhook notification using pg_net
    PERFORM net.http_post(
        url := webhook_url,
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := payload::text
    );

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Failed to send feature request notification: %', SQLERRM;
        RETURN NEW;
END;
$$;

-- =====================================================
-- B3. cleanup_old_rate_limits() - from schema.sql
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    DELETE FROM public.rate_limits WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$;

-- =====================================================
-- B4. check_rate_limit() - from schema.sql
-- =====================================================

CREATE OR REPLACE FUNCTION check_rate_limit(
    p_identifier TEXT,
    p_action_type TEXT,
    p_max_requests INTEGER,
    p_window_minutes INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    request_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO request_count
    FROM public.rate_limits
    WHERE identifier = p_identifier
      AND action_type = p_action_type
      AND created_at > NOW() - (p_window_minutes || ' minutes')::INTERVAL;

    RETURN request_count >= p_max_requests;
END;
$$;

-- =====================================================
-- B5. record_rate_limit() - from schema.sql
-- =====================================================

CREATE OR REPLACE FUNCTION record_rate_limit(
    p_identifier TEXT,
    p_action_type TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.rate_limits (identifier, action_type)
    VALUES (p_identifier, p_action_type);
END;
$$;

-- =====================================================
-- B6. check_and_record_rate_limit() - from security-fixes-migration.sql (LATEST)
-- =====================================================

CREATE OR REPLACE FUNCTION check_and_record_rate_limit(
    p_identifier TEXT,
    p_action_type TEXT,
    p_max_attempts INTEGER,
    p_window_minutes INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count INTEGER;
    v_window_start TIMESTAMPTZ;
BEGIN
    v_window_start := NOW() - (p_window_minutes || ' minutes')::INTERVAL;

    -- Count recent attempts
    SELECT COUNT(*) INTO v_count
    FROM public.rate_limits
    WHERE identifier = p_identifier
      AND action_type = p_action_type
      AND created_at > v_window_start;

    -- Check if over limit
    IF v_count >= p_max_attempts THEN
        RETURN FALSE;
    END IF;

    -- Record this attempt
    INSERT INTO public.rate_limits (identifier, action_type)
    VALUES (p_identifier, p_action_type);

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION check_and_record_rate_limit(TEXT, TEXT, INTEGER, INTEGER) TO anon, authenticated;

-- =====================================================
-- B7. soft_delete() - from soft-delete-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION soft_delete(
    p_table_name TEXT,
    p_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    EXECUTE format(
        'UPDATE public.%I SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2 AND deleted_at IS NULL',
        p_table_name
    ) USING p_user_id, p_id;

    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION soft_delete(TEXT, UUID, UUID) TO authenticated;

-- =====================================================
-- B8. restore_deleted() - from soft-delete-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION restore_deleted(
    p_table_name TEXT,
    p_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deleted_at TIMESTAMPTZ;
BEGIN
    -- Check if item exists and is within recovery window
    EXECUTE format(
        'SELECT deleted_at FROM public.%I WHERE id = $1',
        p_table_name
    ) INTO v_deleted_at USING p_id;

    IF v_deleted_at IS NULL THEN
        RAISE EXCEPTION 'Item not found or not deleted';
    END IF;

    IF v_deleted_at < NOW() - INTERVAL '1 hour' THEN
        RAISE EXCEPTION 'Recovery window expired (1 hour limit)';
    END IF;

    -- Restore the item
    EXECUTE format(
        'UPDATE public.%I SET deleted_at = NULL, deleted_by = NULL WHERE id = $1',
        p_table_name
    ) USING p_id;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION restore_deleted(TEXT, UUID) TO authenticated;

-- =====================================================
-- B9. cleanup_soft_deleted() - from soft-delete-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_soft_deleted()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count INTEGER := 0;
    v_deleted INTEGER;
BEGIN
    -- Delete expired projects
    DELETE FROM public.projects
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '1 hour';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_count := v_count + v_deleted;

    -- Delete expired automations
    DELETE FROM public.automations
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '1 hour';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_count := v_count + v_deleted;

    -- Delete expired customers
    DELETE FROM public.customers
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '1 hour';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_count := v_count + v_deleted;

    -- Delete expired blog posts
    DELETE FROM public.blog_posts
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '1 hour';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_count := v_count + v_deleted;

    -- Delete expired project-customer links
    DELETE FROM public.project_customers
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '1 hour';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_count := v_count + v_deleted;

    RETURN v_count;
END;
$$;

-- =====================================================
-- B10. get_app_by_slug() - from customer-app-signup-function.sql (LATEST)
-- =====================================================

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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    FROM public.customer_apps ca
    WHERE ca.slug = p_slug
      AND ca.is_published = true
      AND ca.is_active = true
      AND ca.deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION get_app_by_slug(TEXT) TO anon, authenticated;

-- =====================================================
-- B11. customer_app_signup() - from member-limits-enforcement.sql (LATEST)
-- =====================================================

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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    FROM public.customer_apps
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
    FROM public.app_members
    WHERE app_id = p_app_id AND email = lower(p_email) AND deleted_at IS NULL;

    IF FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'Email already registered. Please log in instead.'::TEXT;
        RETURN;
    END IF;

    -- Check for existing member with this phone (if phone provided)
    IF p_phone IS NOT NULL AND p_phone != '' THEN
        SELECT id INTO v_existing_member
        FROM public.app_members
        WHERE app_id = p_app_id AND phone = p_phone AND deleted_at IS NULL;

        IF FOUND THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'Phone number already registered. Please use a different number or log in.'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- Get welcome points from settings
    v_welcome_points := COALESCE((v_app.settings->>'welcome_points')::INTEGER, 50);

    -- Create customer record in org's customers table
    INSERT INTO public.customers (
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
    INSERT INTO public.app_members (
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
    INSERT INTO public.points_transactions (
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
    INSERT INTO public.app_events (
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
$$;

GRANT EXECUTE ON FUNCTION customer_app_signup(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- =====================================================
-- B12. get_org_member_limit() - from member-limits-enforcement.sql
-- =====================================================

CREATE OR REPLACE FUNCTION get_org_member_limit(p_org_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org RECORD;
    v_limit INTEGER;
BEGIN
    SELECT plan_type, appsumo_tier, subscription_tier, plan_limits_override
    INTO v_org
    FROM public.organizations
    WHERE id = p_org_id;

    IF NOT FOUND THEN
        RETURN 50;
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
$$;

GRANT EXECUTE ON FUNCTION get_org_member_limit(UUID) TO anon, authenticated;

-- =====================================================
-- B13. count_org_members() - from member-limits-enforcement.sql
-- =====================================================

CREATE OR REPLACE FUNCTION count_org_members(p_org_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.app_members am
    JOIN public.customer_apps ca ON am.app_id = ca.id
    WHERE ca.organization_id = p_org_id
      AND am.deleted_at IS NULL;

    RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION count_org_members(UUID) TO anon, authenticated;

-- =====================================================
-- B14. check_member_limit() - from member-limits-enforcement.sql
-- =====================================================

CREATE OR REPLACE FUNCTION check_member_limit(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION check_member_limit(UUID) TO anon, authenticated;

-- =====================================================
-- B15. award_points() - from security-fixes-migration.sql (LATEST with FOR UPDATE)
-- =====================================================

CREATE OR REPLACE FUNCTION award_points(
    p_app_id UUID,
    p_member_id UUID,
    p_points INTEGER,
    p_type TEXT DEFAULT 'manual',
    p_description TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS TABLE (
    new_balance INTEGER,
    new_tier TEXT,
    tier_changed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old_balance INTEGER;
    v_new_balance INTEGER;
    v_old_tier TEXT;
    v_new_tier TEXT;
    v_tier_thresholds JSONB;
BEGIN
    -- SECURITY FIX: Lock the row to prevent race conditions
    SELECT points_balance, tier INTO v_old_balance, v_old_tier
    FROM public.app_members
    WHERE id = p_member_id AND app_id = p_app_id
    FOR UPDATE;

    -- Calculate new balance
    v_new_balance := v_old_balance + p_points;

    -- Get tier thresholds
    SELECT settings->'tier_thresholds' INTO v_tier_thresholds
    FROM public.customer_apps
    WHERE id = p_app_id;

    -- Determine new tier based on total earned
    SELECT
        CASE
            WHEN v_new_balance >= COALESCE((v_tier_thresholds->>'platinum')::INTEGER, 5000) THEN 'platinum'
            WHEN v_new_balance >= COALESCE((v_tier_thresholds->>'gold')::INTEGER, 1500) THEN 'gold'
            WHEN v_new_balance >= COALESCE((v_tier_thresholds->>'silver')::INTEGER, 500) THEN 'silver'
            ELSE 'bronze'
        END INTO v_new_tier;

    -- Update member (atomic with the lock)
    UPDATE public.app_members
    SET
        points_balance = v_new_balance,
        total_points_earned = total_points_earned + GREATEST(p_points, 0),
        tier = v_new_tier,
        updated_at = NOW()
    WHERE id = p_member_id;

    -- Record transaction
    INSERT INTO public.points_transactions (app_id, member_id, type, points_change, balance_after, description, metadata)
    VALUES (p_app_id, p_member_id, p_type, p_points, v_new_balance, p_description, p_metadata);

    -- If tier changed, record event
    IF v_new_tier != v_old_tier AND p_points > 0 THEN
        INSERT INTO public.app_events (app_id, member_id, event_type, event_data)
        VALUES (p_app_id, p_member_id, 'tier_upgrade', jsonb_build_object(
            'old_tier', v_old_tier,
            'new_tier', v_new_tier
        ));
    END IF;

    RETURN QUERY SELECT v_new_balance, v_new_tier, (v_new_tier != v_old_tier);
END;
$$;

GRANT EXECUTE ON FUNCTION award_points(UUID, UUID, INTEGER, TEXT, TEXT, JSONB) TO authenticated;

-- =====================================================
-- B16. redeem_reward() - from security-fixes-migration.sql (LATEST with FOR UPDATE)
-- =====================================================

CREATE OR REPLACE FUNCTION redeem_reward(
    p_app_id UUID,
    p_member_id UUID,
    p_reward_id UUID
)
RETURNS TABLE (
    success BOOLEAN,
    redemption_id UUID,
    redemption_code TEXT,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reward RECORD;
    v_member RECORD;
    v_redemption_id UUID;
    v_redemption_code TEXT;
    v_member_redemption_count INTEGER;
BEGIN
    -- SECURITY FIX: Lock the reward row to prevent overselling
    SELECT * INTO v_reward
    FROM public.app_rewards
    WHERE id = p_reward_id AND app_id = p_app_id AND is_active = true AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Reward not found or inactive';
        RETURN;
    END IF;

    -- Check dates
    IF v_reward.start_date IS NOT NULL AND v_reward.start_date > NOW() THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Reward not yet available';
        RETURN;
    END IF;

    IF v_reward.end_date IS NOT NULL AND v_reward.end_date < NOW() THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Reward has expired';
        RETURN;
    END IF;

    -- Check quantity (now safe with FOR UPDATE lock)
    IF v_reward.quantity_available IS NOT NULL AND v_reward.quantity_redeemed >= v_reward.quantity_available THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Reward is out of stock';
        RETURN;
    END IF;

    -- SECURITY FIX: Lock the member row too
    SELECT * INTO v_member
    FROM public.app_members
    WHERE id = p_member_id AND app_id = p_app_id AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Member not found';
        RETURN;
    END IF;

    -- Check tier requirement
    IF v_reward.tier_required IS NOT NULL THEN
        IF v_reward.tier_required = 'platinum' AND v_member.tier NOT IN ('platinum') THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Platinum tier required';
            RETURN;
        ELSIF v_reward.tier_required = 'gold' AND v_member.tier NOT IN ('gold', 'platinum') THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Gold tier or higher required';
            RETURN;
        ELSIF v_reward.tier_required = 'silver' AND v_member.tier NOT IN ('silver', 'gold', 'platinum') THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Silver tier or higher required';
            RETURN;
        END IF;
    END IF;

    -- Check points (now safe with FOR UPDATE lock)
    IF v_member.points_balance < v_reward.points_cost THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Insufficient points';
        RETURN;
    END IF;

    -- Check max per member
    IF v_reward.max_per_member IS NOT NULL THEN
        SELECT COUNT(*) INTO v_member_redemption_count
        FROM public.reward_redemptions
        WHERE member_id = p_member_id AND reward_id = p_reward_id AND status != 'cancelled';

        IF v_member_redemption_count >= v_reward.max_per_member THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Maximum redemptions reached for this reward';
            RETURN;
        END IF;
    END IF;

    -- Generate redemption code
    v_redemption_code := upper(substring(md5(random()::text) from 1 for 8));

    -- Create redemption
    INSERT INTO public.reward_redemptions (app_id, member_id, reward_id, points_spent, reward_name, redemption_code, expires_at)
    VALUES (p_app_id, p_member_id, p_reward_id, v_reward.points_cost, v_reward.name, v_redemption_code, NOW() + INTERVAL '30 days')
    RETURNING id INTO v_redemption_id;

    -- Deduct points (uses the same transaction, so still locked)
    PERFORM award_points(p_app_id, p_member_id, -v_reward.points_cost, 'reward_redeem',
        'Redeemed: ' || v_reward.name,
        jsonb_build_object('reward_id', p_reward_id, 'redemption_id', v_redemption_id));

    -- Update reward quantity (atomic within same transaction)
    UPDATE public.app_rewards
    SET quantity_redeemed = quantity_redeemed + 1, updated_at = NOW()
    WHERE id = p_reward_id;

    -- Update member total redeemed
    UPDATE public.app_members
    SET total_points_redeemed = total_points_redeemed + v_reward.points_cost, updated_at = NOW()
    WHERE id = p_member_id;

    -- Record event
    INSERT INTO public.app_events (app_id, member_id, event_type, event_data)
    VALUES (p_app_id, p_member_id, 'reward_redeemed', jsonb_build_object(
        'reward_id', p_reward_id,
        'reward_name', v_reward.name,
        'points_spent', v_reward.points_cost,
        'redemption_id', v_redemption_id
    ));

    RETURN QUERY SELECT true, v_redemption_id, v_redemption_code, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION redeem_reward(UUID, UUID, UUID) TO authenticated;

-- =====================================================
-- B17. record_member_visit() - from security-fixes-migration.sql (LATEST)
-- =====================================================

CREATE OR REPLACE FUNCTION record_member_visit(
    p_member_id UUID,
    p_app_id UUID,
    p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_member RECORD;
    v_app RECORD;
    v_visits_today INTEGER;
    v_points_per_visit INTEGER;
    v_daily_limit INTEGER;
    v_today DATE := CURRENT_DATE;
    v_last_visit DATE;
    v_new_streak INTEGER;
    v_streak_bonus INTEGER := 0;
    v_milestone_bonus INTEGER := 0;
    v_total_points INTEGER;
    v_visit_id UUID;
BEGIN
    SELECT * INTO v_app
    FROM public.customer_apps
    WHERE id = p_app_id AND deleted_at IS NULL;

    IF v_app.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'App not found');
    END IF;

    v_points_per_visit := COALESCE((v_app.settings->>'points_per_visit')::INTEGER, 10);
    v_daily_limit := COALESCE((v_app.settings->>'daily_visit_limit')::INTEGER, 1);

    SELECT * INTO v_member
    FROM public.app_members
    WHERE id = p_member_id AND app_id = p_app_id AND deleted_at IS NULL
    FOR UPDATE;

    IF v_member.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Member not found');
    END IF;

    SELECT COUNT(*) INTO v_visits_today
    FROM public.member_visits
    WHERE member_id = p_member_id AND DATE(visited_at) = v_today;

    IF v_visits_today >= v_daily_limit THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Daily visit limit reached', 'visits_today', v_visits_today, 'daily_limit', v_daily_limit);
    END IF;

    v_last_visit := DATE(v_member.last_visit_at);
    IF v_last_visit = v_today - INTERVAL '1 day' THEN
        v_new_streak := COALESCE(v_member.current_streak, 0) + 1;
    ELSIF v_last_visit = v_today THEN
        v_new_streak := COALESCE(v_member.current_streak, 1);
    ELSE
        v_new_streak := 1;
    END IF;

    IF v_new_streak = 3 THEN v_streak_bonus := 5;
    ELSIF v_new_streak = 7 THEN v_streak_bonus := 15;
    ELSIF v_new_streak = 30 THEN v_streak_bonus := 50;
    END IF;

    IF (v_member.visit_count + 1) = 10 THEN v_milestone_bonus := 25;
    ELSIF (v_member.visit_count + 1) = 50 THEN v_milestone_bonus := 100;
    ELSIF (v_member.visit_count + 1) = 100 THEN v_milestone_bonus := 250;
    END IF;

    v_total_points := v_points_per_visit + v_streak_bonus + v_milestone_bonus;

    INSERT INTO public.member_visits (member_id, app_id, points_awarded, streak_bonus, milestone_bonus, location_id)
    VALUES (p_member_id, p_app_id, v_points_per_visit, v_streak_bonus, v_milestone_bonus, p_location_id)
    RETURNING id INTO v_visit_id;

    UPDATE public.app_members
    SET points_balance = points_balance + v_total_points, total_points_earned = total_points_earned + v_total_points,
        visit_count = visit_count + 1, current_streak = v_new_streak,
        longest_streak = GREATEST(longest_streak, v_new_streak), last_visit_at = NOW()
    WHERE id = p_member_id;

    INSERT INTO public.points_transactions (member_id, app_id, type, points_change, description, metadata)
    VALUES (p_member_id, p_app_id, 'visit', v_total_points,
        CASE WHEN v_streak_bonus > 0 AND v_milestone_bonus > 0 THEN 'Visit + ' || v_new_streak || '-day streak + Milestone bonus!'
            WHEN v_streak_bonus > 0 THEN 'Visit + ' || v_new_streak || '-day streak bonus!'
            WHEN v_milestone_bonus > 0 THEN 'Visit + Milestone bonus!'
            ELSE 'Check-in visit' END,
        jsonb_build_object('visit_id', v_visit_id, 'base_points', v_points_per_visit, 'streak_bonus', v_streak_bonus, 'milestone_bonus', v_milestone_bonus, 'streak_days', v_new_streak));

    RETURN jsonb_build_object('success', true, 'points_awarded', v_total_points, 'base_points', v_points_per_visit,
        'streak_bonus', v_streak_bonus, 'milestone_bonus', v_milestone_bonus, 'current_streak', v_new_streak,
        'visit_count', v_member.visit_count + 1, 'new_balance', v_member.points_balance + v_total_points);
END;
$$;

GRANT EXECUTE ON FUNCTION record_member_visit(UUID, UUID, UUID) TO anon, authenticated;

-- =====================================================
-- B18. get_app_leaderboard() - from customer-apps-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION get_app_leaderboard(p_app_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (rank BIGINT, display_name TEXT, avatar_url TEXT, points_balance INTEGER, tier TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    RETURN QUERY
    SELECT ROW_NUMBER() OVER (ORDER BY am.points_balance DESC) as rank,
        COALESCE(am.display_name, am.first_name, 'Anonymous') as display_name, am.avatar_url, am.points_balance, am.tier
    FROM public.app_members am
    WHERE am.app_id = p_app_id AND am.profile_public = true AND am.deleted_at IS NULL
    ORDER BY am.points_balance DESC LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_app_leaderboard(UUID, INTEGER) TO anon, authenticated;

-- =====================================================
-- B19. verify_app_member_login() - from verify-login-function.sql
-- =====================================================

CREATE OR REPLACE FUNCTION verify_app_member_login(
    p_app_id UUID, p_email TEXT DEFAULT NULL, p_phone TEXT DEFAULT NULL, p_pin_hash TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_member public.app_members%ROWTYPE;
    v_app public.customer_apps%ROWTYPE;
    v_identifier TEXT;
    v_is_allowed BOOLEAN;
BEGIN
    IF p_email IS NULL AND p_phone IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Email or phone required');
    END IF;
    IF p_pin_hash IS NULL OR LENGTH(p_pin_hash) < 10 THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Invalid PIN');
    END IF;
    v_identifier := p_app_id::TEXT || ':' || COALESCE(LOWER(p_email), p_phone);
    v_is_allowed := check_and_record_rate_limit(v_identifier, 'member_login', 5, 15);
    IF NOT v_is_allowed THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Too many login attempts. Please try again in 15 minutes.', 'rate_limited', true);
    END IF;
    SELECT * INTO v_app FROM public.customer_apps WHERE id = p_app_id AND is_active = true AND deleted_at IS NULL;
    IF v_app.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'App not found or inactive');
    END IF;
    IF p_email IS NOT NULL THEN
        SELECT * INTO v_member FROM public.app_members WHERE app_id = p_app_id AND LOWER(email) = LOWER(p_email) AND deleted_at IS NULL;
    ELSE
        SELECT * INTO v_member FROM public.app_members WHERE app_id = p_app_id AND phone = p_phone AND deleted_at IS NULL;
    END IF;
    IF v_member.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Invalid credentials');
    END IF;
    IF v_member.pin_hash != p_pin_hash THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Invalid credentials');
    END IF;
    UPDATE public.app_members SET last_login_at = NOW() WHERE id = v_member.id;
    RETURN jsonb_build_object('success', true, 'member_id', v_member.id, 'display_name', v_member.display_name, 'tier', v_member.tier, 'points_balance', v_member.points_balance);
END;
$$;

GRANT EXECUTE ON FUNCTION verify_app_member_login(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;

-- =====================================================
-- B20. preview_app_by_id() - from preview-app-function.sql
-- =====================================================

CREATE OR REPLACE FUNCTION preview_app_by_id(p_app_id UUID)
RETURNS TABLE (id UUID, organization_id UUID, name TEXT, slug TEXT, description TEXT, app_type TEXT, branding JSONB, features JSONB, settings JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    RETURN QUERY
    SELECT ca.id, ca.organization_id, ca.name::TEXT, ca.slug::TEXT, ca.description::TEXT, ca.app_type::TEXT, ca.branding, ca.features,
        jsonb_build_object('welcome_points', ca.settings->'welcome_points', 'tier_thresholds', ca.settings->'tier_thresholds',
            'require_email', ca.settings->'require_email', 'require_phone', ca.settings->'require_phone') as settings
    FROM public.customer_apps ca WHERE ca.id = p_app_id AND ca.deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION preview_app_by_id(UUID) TO anon, authenticated;

-- =====================================================
-- B21. cleanup_old_webhook_events() - from security-fixes-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_old_webhook_events()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    DELETE FROM public.processed_webhook_events WHERE processed_at < NOW() - INTERVAL '7 days';
END;
$$;

-- =====================================================
-- B22. update_member_profile() - from profile-visits-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION update_member_profile(
    p_member_id UUID, p_first_name TEXT DEFAULT NULL, p_last_name TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL, p_phone TEXT DEFAULT NULL, p_avatar_url TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_member public.app_members%ROWTYPE;
    v_display_name TEXT;
BEGIN
    SELECT * INTO v_member FROM public.app_members WHERE id = p_member_id AND deleted_at IS NULL;
    IF v_member.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Member not found');
    END IF;
    IF p_email IS NOT NULL AND p_email != '' AND LOWER(p_email) != LOWER(COALESCE(v_member.email, '')) THEN
        IF EXISTS (SELECT 1 FROM public.app_members WHERE app_id = v_member.app_id AND LOWER(email) = LOWER(p_email) AND id != p_member_id AND deleted_at IS NULL) THEN
            RETURN jsonb_build_object('success', false, 'error_message', 'Email already in use');
        END IF;
    END IF;
    IF p_phone IS NOT NULL AND p_phone != '' AND p_phone != COALESCE(v_member.phone, '') THEN
        IF EXISTS (SELECT 1 FROM public.app_members WHERE app_id = v_member.app_id AND phone = p_phone AND id != p_member_id AND deleted_at IS NULL) THEN
            RETURN jsonb_build_object('success', false, 'error_message', 'Phone number already in use');
        END IF;
    END IF;
    v_display_name := TRIM(COALESCE(p_first_name, v_member.first_name, '') || ' ' || COALESCE(p_last_name, v_member.last_name, ''));
    IF v_display_name = '' THEN v_display_name := NULL; END IF;
    UPDATE public.app_members SET first_name = COALESCE(NULLIF(p_first_name, ''), first_name), last_name = COALESCE(NULLIF(p_last_name, ''), last_name),
        display_name = COALESCE(v_display_name, display_name), email = COALESCE(NULLIF(p_email, ''), email),
        phone = COALESCE(NULLIF(p_phone, ''), phone), avatar_url = COALESCE(p_avatar_url, avatar_url), updated_at = NOW()
    WHERE id = p_member_id;
    SELECT * INTO v_member FROM public.app_members WHERE id = p_member_id;
    RETURN jsonb_build_object('success', true, 'member', jsonb_build_object(
        'id', v_member.id, 'first_name', v_member.first_name, 'last_name', v_member.last_name,
        'display_name', v_member.display_name, 'email', v_member.email, 'phone', v_member.phone,
        'avatar_url', v_member.avatar_url, 'tier', v_member.tier, 'points_balance', v_member.points_balance));
END;
$$;

GRANT EXECUTE ON FUNCTION update_member_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- =====================================================
-- B23. create_support_ticket() - from support-system-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION create_support_ticket(
    p_app_id UUID, p_member_id UUID, p_subject TEXT, p_description TEXT,
    p_ticket_type TEXT DEFAULT 'question', p_category TEXT DEFAULT NULL, p_metadata JSONB DEFAULT '{}'
)
RETURNS TABLE (success BOOLEAN, ticket_id UUID, ticket_number TEXT, error_message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_org_id UUID; v_ticket_id UUID; v_ticket_number TEXT;
BEGIN
    SELECT organization_id INTO v_org_id FROM public.customer_apps WHERE id = p_app_id;
    IF v_org_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'App not found'; RETURN;
    END IF;
    v_ticket_number := generate_ticket_number(p_app_id);
    INSERT INTO public.support_tickets (app_id, member_id, organization_id, ticket_number, subject, description, ticket_type, category, metadata)
    VALUES (p_app_id, p_member_id, v_org_id, v_ticket_number, p_subject, p_description, p_ticket_type, p_category, p_metadata)
    RETURNING id INTO v_ticket_id;
    INSERT INTO public.ticket_messages (ticket_id, sender_type, sender_id, message)
    SELECT v_ticket_id, 'customer', p_member_id, p_description;
    RETURN QUERY SELECT true, v_ticket_id, v_ticket_number, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION create_support_ticket TO anon, authenticated;

-- =====================================================
-- B24. search_knowledgebase() - from support-system-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION search_knowledgebase(p_app_id UUID, p_query TEXT, p_limit INTEGER DEFAULT 5)
RETURNS TABLE (id UUID, title TEXT, excerpt TEXT, content TEXT, category TEXT, relevance REAL)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    RETURN QUERY
    SELECT ka.id, ka.title, ka.excerpt, ka.content, ka.category,
        ts_rank(to_tsvector('english', ka.title || ' ' || COALESCE(ka.content, '')), plainto_tsquery('english', p_query)) as relevance
    FROM public.knowledgebase_articles ka
    WHERE ka.app_id = p_app_id AND ka.is_published = true
      AND to_tsvector('english', ka.title || ' ' || COALESCE(ka.content, '')) @@ plainto_tsquery('english', p_query)
    ORDER BY relevance DESC LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION search_knowledgebase TO anon, authenticated;

-- =====================================================
-- B25. search_faqs() - from support-system-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION search_faqs(p_app_id UUID, p_query TEXT, p_limit INTEGER DEFAULT 5)
RETURNS TABLE (id UUID, question TEXT, answer TEXT, category TEXT, relevance REAL)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    RETURN QUERY
    SELECT f.id, f.question, f.answer, f.category,
        ts_rank(to_tsvector('english', f.question || ' ' || f.answer), plainto_tsquery('english', p_query)) as relevance
    FROM public.faq_items f
    WHERE f.app_id = p_app_id AND f.is_active = true
      AND to_tsvector('english', f.question || ' ' || f.answer) @@ plainto_tsquery('english', p_query)
    ORDER BY relevance DESC LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION search_faqs TO anon, authenticated;

-- =====================================================
-- B26. get_ai_support_context() - from support-system-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION get_ai_support_context(p_app_id UUID, p_member_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_result JSONB; v_app RECORD; v_org RECORD; v_member RECORD; v_rewards JSONB; v_faqs JSONB;
BEGIN
    SELECT * INTO v_app FROM public.customer_apps WHERE id = p_app_id;
    IF v_app IS NULL THEN RETURN jsonb_build_object('error', 'App not found'); END IF;
    SELECT * INTO v_org FROM public.organizations WHERE id = v_app.organization_id;
    IF p_member_id IS NOT NULL THEN
        SELECT am.*, (SELECT COUNT(*) FROM public.member_visits WHERE member_id = am.id) as visit_count,
            (SELECT COUNT(*) FROM public.reward_redemptions WHERE member_id = am.id) as redemption_count
        INTO v_member FROM public.app_members am WHERE am.id = p_member_id;
    END IF;
    SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'description', r.description, 'points_cost', r.points_cost, 'tier_required', r.tier_required))
    INTO v_rewards FROM public.app_rewards r WHERE r.app_id = p_app_id AND r.is_active = true ORDER BY r.points_cost;
    SELECT jsonb_agg(jsonb_build_object('question', f.question, 'answer', f.answer, 'category', f.category))
    INTO v_faqs FROM (SELECT * FROM public.faq_items WHERE app_id = p_app_id AND is_active = true ORDER BY display_order, times_shown DESC LIMIT 10) f;
    v_result := jsonb_build_object(
        'app', jsonb_build_object('id', v_app.id, 'name', v_app.name, 'slug', v_app.slug, 'app_type', v_app.app_type,
            'description', v_app.description, 'settings', v_app.settings, 'features', v_app.features, 'ai_autonomy_mode', v_app.ai_autonomy_mode),
        'organization', jsonb_build_object('name', v_org.name, 'plan_type', v_org.plan_type),
        'rewards', COALESCE(v_rewards, '[]'::jsonb), 'faqs', COALESCE(v_faqs, '[]'::jsonb),
        'tier_thresholds', COALESCE(v_app.settings->'tier_thresholds', '{"bronze": 0, "silver": 500, "gold": 1500, "platinum": 5000}'::jsonb));
    IF v_member IS NOT NULL THEN
        v_result := v_result || jsonb_build_object('member', jsonb_build_object(
            'id', v_member.id, 'first_name', v_member.first_name, 'display_name', v_member.display_name,
            'points_balance', v_member.points_balance, 'total_points_earned', v_member.total_points_earned,
            'tier', v_member.tier, 'visit_count', v_member.visit_count, 'current_streak', v_member.current_streak,
            'longest_streak', v_member.longest_streak, 'redemption_count', v_member.redemption_count, 'joined_at', v_member.joined_at));
    END IF;
    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ai_support_context TO anon, authenticated;

-- =====================================================
-- B27. record_kb_feedback() - from support-system-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION record_kb_feedback(p_article_id UUID, p_helpful BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_helpful THEN
        UPDATE public.knowledgebase_articles SET helpful_count = helpful_count + 1, view_count = view_count + 1 WHERE id = p_article_id;
    ELSE
        UPDATE public.knowledgebase_articles SET not_helpful_count = not_helpful_count + 1, view_count = view_count + 1 WHERE id = p_article_id;
    END IF;
    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION record_kb_feedback TO anon, authenticated;

-- =====================================================
-- B28. record_faq_feedback() - from support-system-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION record_faq_feedback(p_faq_id UUID, p_helpful BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_helpful THEN
        UPDATE public.faq_items SET times_helpful = times_helpful + 1, times_shown = times_shown + 1 WHERE id = p_faq_id;
    ELSE
        UPDATE public.faq_items SET times_not_helpful = times_not_helpful + 1, times_shown = times_shown + 1 WHERE id = p_faq_id;
    END IF;
    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION record_faq_feedback TO anon, authenticated;

-- =====================================================
-- B29. subscribe_to_newsletter() - from newsletter-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION subscribe_to_newsletter(
    p_app_id UUID, p_email TEXT, p_first_name TEXT DEFAULT NULL, p_last_name TEXT DEFAULT NULL,
    p_preferred_language TEXT DEFAULT 'en', p_source TEXT DEFAULT 'signup_form',
    p_utm_source TEXT DEFAULT NULL, p_utm_medium TEXT DEFAULT NULL, p_utm_campaign TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_app public.customer_apps%ROWTYPE; v_existing public.newsletter_subscribers%ROWTYPE;
    v_subscriber public.newsletter_subscribers%ROWTYPE; v_token TEXT; v_is_allowed BOOLEAN;
BEGIN
    IF p_email IS NULL OR p_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Invalid email address');
    END IF;
    v_is_allowed := check_and_record_rate_limit(LOWER(p_email), 'newsletter_subscribe', 10, 60);
    IF NOT v_is_allowed THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Too many attempts. Please try again later.');
    END IF;
    SELECT * INTO v_app FROM public.customer_apps WHERE id = p_app_id AND is_published = true AND deleted_at IS NULL;
    IF v_app.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Newsletter not found');
    END IF;
    SELECT * INTO v_existing FROM public.newsletter_subscribers WHERE app_id = p_app_id AND LOWER(email) = LOWER(p_email) AND deleted_at IS NULL;
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.status = 'active' THEN
            RETURN jsonb_build_object('success', false, 'error_message', 'This email is already subscribed');
        ELSIF v_existing.status = 'unsubscribed' THEN
            v_token := encode(gen_random_bytes(32), 'hex');
            UPDATE public.newsletter_subscribers SET status = 'pending', confirmation_token = v_token,
                confirmation_expires_at = NOW() + INTERVAL '24 hours', unsubscribed_at = NULL, unsubscribe_reason = NULL, updated_at = NOW()
            WHERE id = v_existing.id;
            RETURN jsonb_build_object('success', true, 'message', 'Please check your email to confirm your subscription', 'confirmation_token', v_token, 'subscriber_id', v_existing.id);
        ELSE
            v_token := encode(gen_random_bytes(32), 'hex');
            UPDATE public.newsletter_subscribers SET confirmation_token = v_token, confirmation_expires_at = NOW() + INTERVAL '24 hours', updated_at = NOW()
            WHERE id = v_existing.id;
            RETURN jsonb_build_object('success', true, 'message', 'Confirmation email resent', 'confirmation_token', v_token, 'subscriber_id', v_existing.id);
        END IF;
    END IF;
    v_token := encode(gen_random_bytes(32), 'hex');
    INSERT INTO public.newsletter_subscribers (app_id, email, first_name, last_name, preferred_language, source, utm_source, utm_medium, utm_campaign, confirmation_token, confirmation_expires_at)
    VALUES (p_app_id, LOWER(p_email), p_first_name, p_last_name, p_preferred_language, p_source, p_utm_source, p_utm_medium, p_utm_campaign, v_token, NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_subscriber;
    RETURN jsonb_build_object('success', true, 'message', 'Please check your email to confirm your subscription', 'confirmation_token', v_token, 'subscriber_id', v_subscriber.id);
END;
$$;

GRANT EXECUTE ON FUNCTION subscribe_to_newsletter TO anon, authenticated;

-- =====================================================
-- B30. confirm_newsletter_subscription() - from newsletter-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION confirm_newsletter_subscription(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_subscriber public.newsletter_subscribers%ROWTYPE;
BEGIN
    SELECT * INTO v_subscriber FROM public.newsletter_subscribers WHERE confirmation_token = p_token AND deleted_at IS NULL;
    IF v_subscriber.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error_message', 'Invalid confirmation link'); END IF;
    IF v_subscriber.confirmation_expires_at < NOW() THEN RETURN jsonb_build_object('success', false, 'error_message', 'Confirmation link has expired. Please subscribe again.'); END IF;
    IF v_subscriber.status = 'active' THEN RETURN jsonb_build_object('success', true, 'message', 'Your subscription is already confirmed'); END IF;
    UPDATE public.newsletter_subscribers SET status = 'active', confirmed_at = NOW(), confirmation_token = NULL, confirmation_expires_at = NULL, updated_at = NOW() WHERE id = v_subscriber.id;
    RETURN jsonb_build_object('success', true, 'message', 'Your subscription has been confirmed!');
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_newsletter_subscription TO anon, authenticated;

-- =====================================================
-- B31. create_escalation_notification() - from escalation-notifications-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION create_escalation_notification(
    p_organization_id UUID, p_app_id UUID, p_ticket_id UUID, p_session_id UUID,
    p_member_id UUID, p_escalation_reason TEXT, p_customer_message TEXT, p_confidence DECIMAL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_notification_id UUID; v_app_name TEXT; v_member_name TEXT; v_title TEXT; v_message TEXT; v_priority TEXT;
BEGIN
    SELECT name INTO v_app_name FROM public.customer_apps WHERE id = p_app_id;
    SELECT first_name || ' ' || last_name INTO v_member_name FROM public.app_members WHERE id = p_member_id;
    v_priority := CASE WHEN p_escalation_reason = 'escalation_keyword' THEN 'high' ELSE 'normal' END;
    v_title := CASE p_escalation_reason
        WHEN 'escalation_keyword' THEN '🚨 Customer requested human support'
        WHEN 'low_confidence' THEN '⚠️ AI needs help with customer question'
        WHEN 'max_turns_reached' THEN '💬 Extended conversation needs attention'
        WHEN 'ai_disabled' THEN '📩 New support request (AI disabled)'
        ELSE '📩 Support escalation' END;
    v_message := COALESCE(v_member_name, 'A customer') || ' from ' || COALESCE(v_app_name, 'your app') || ' needs assistance. ' ||
        CASE WHEN p_escalation_reason = 'escalation_keyword' THEN 'They specifically asked to speak with a human.'
            WHEN p_escalation_reason = 'low_confidence' THEN 'The AI wasn''t confident about the answer.'
            WHEN p_escalation_reason = 'max_turns_reached' THEN 'The conversation has been going for a while without resolution.'
            ELSE '' END;
    INSERT INTO public.owner_notifications (organization_id, notification_type, title, message, ticket_id, session_id, app_id, member_id, priority, metadata)
    VALUES (p_organization_id, 'escalation', v_title, v_message, p_ticket_id, p_session_id, p_app_id, p_member_id, v_priority,
        jsonb_build_object('escalation_reason', p_escalation_reason, 'customer_message', LEFT(p_customer_message, 500), 'ai_confidence', p_confidence))
    RETURNING id INTO v_notification_id;
    RETURN v_notification_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_escalation_notification TO service_role;

-- =====================================================
-- B32. send_escalation_webhook() - from escalation-notifications-migration.sql
-- =====================================================

CREATE OR REPLACE FUNCTION send_escalation_webhook(
    p_app_id UUID, p_ticket_id UUID, p_member_id UUID, p_escalation_reason TEXT, p_customer_message TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_webhook_url TEXT; v_app_name TEXT; v_member_name TEXT; v_member_email TEXT; v_payload JSONB;
BEGIN
    SELECT notification_webhook_url INTO v_webhook_url FROM public.support_settings
    WHERE app_id = p_app_id AND notify_on_escalation = true AND notification_webhook_url IS NOT NULL AND notification_webhook_url != '';
    IF v_webhook_url IS NULL THEN RETURN FALSE; END IF;
    SELECT name INTO v_app_name FROM public.customer_apps WHERE id = p_app_id;
    SELECT first_name || ' ' || last_name, email INTO v_member_name, v_member_email FROM public.app_members WHERE id = p_member_id;
    v_payload := jsonb_build_object('text', '🚨 Support Escalation: ' || COALESCE(v_member_name, 'Customer') || ' needs help',
        'blocks', jsonb_build_array(
            jsonb_build_object('type', 'header', 'text', jsonb_build_object('type', 'plain_text', 'text', '🚨 Support Escalation', 'emoji', true)),
            jsonb_build_object('type', 'section', 'fields', jsonb_build_array(
                jsonb_build_object('type', 'mrkdwn', 'text', '*App:* ' || COALESCE(v_app_name, 'Unknown')),
                jsonb_build_object('type', 'mrkdwn', 'text', '*Customer:* ' || COALESCE(v_member_name, 'Unknown')),
                jsonb_build_object('type', 'mrkdwn', 'text', '*Email:* ' || COALESCE(v_member_email, 'N/A')),
                jsonb_build_object('type', 'mrkdwn', 'text', '*Reason:* ' || REPLACE(p_escalation_reason, '_', ' ')))),
            jsonb_build_object('type', 'section', 'text', jsonb_build_object('type', 'mrkdwn', 'text', '*Customer Message:*\n>' || LEFT(p_customer_message, 500))),
            jsonb_build_object('type', 'actions', 'elements', jsonb_build_array(
                jsonb_build_object('type', 'button', 'text', jsonb_build_object('type', 'plain_text', 'text', 'View Ticket'),
                    'url', 'https://royaltyapp.ai/app/support.html?ticket=' || p_ticket_id::TEXT)))));
    BEGIN
        PERFORM net.http_post(url := v_webhook_url, headers := '{"Content-Type": "application/json"}'::jsonb, body := v_payload::text);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to send escalation webhook: %', SQLERRM; RETURN FALSE;
    END;
    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION send_escalation_webhook TO service_role;

-- B33: handle_support_escalation
CREATE OR REPLACE FUNCTION handle_support_escalation(
    p_app_id UUID,
    p_organization_id UUID,
    p_ticket_id UUID,
    p_session_id UUID,
    p_member_id UUID,
    p_escalation_reason TEXT,
    p_customer_message TEXT,
    p_confidence DECIMAL DEFAULT 0.5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_notification_id UUID;
    v_webhook_sent BOOLEAN;
    v_settings RECORD;
BEGIN
    -- Get notification settings
    SELECT notify_on_escalation, notification_email, notification_webhook_url
    INTO v_settings
    FROM public.support_settings
    WHERE app_id = p_app_id;

    -- Default to true if no settings found
    IF v_settings IS NULL THEN
        v_settings.notify_on_escalation := true;
    END IF;

    -- Create in-dashboard notification
    IF v_settings.notify_on_escalation THEN
        v_notification_id := create_escalation_notification(
            p_organization_id,
            p_app_id,
            p_ticket_id,
            p_session_id,
            p_member_id,
            p_escalation_reason,
            p_customer_message,
            p_confidence
        );
    END IF;

    -- Send webhook notification
    v_webhook_sent := send_escalation_webhook(
        p_app_id,
        p_ticket_id,
        p_member_id,
        p_escalation_reason,
        p_customer_message
    );

    RETURN jsonb_build_object(
        'notification_created', v_notification_id IS NOT NULL,
        'notification_id', v_notification_id,
        'webhook_sent', v_webhook_sent
    );
END;
$$;

GRANT EXECUTE ON FUNCTION handle_support_escalation TO service_role;

-- B34: queue_escalation_email
CREATE OR REPLACE FUNCTION queue_escalation_email(
    p_app_id UUID,
    p_member_id UUID,
    p_ticket_id UUID,
    p_escalation_reason TEXT,
    p_customer_message TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_email TEXT;
    v_app_name TEXT;
    v_member_name TEXT;
    v_subject TEXT;
    v_body TEXT;
BEGIN
    -- Get notification email from support settings
    SELECT notification_email INTO v_email
    FROM public.support_settings
    WHERE app_id = p_app_id
    AND notify_on_escalation = true
    AND notification_email IS NOT NULL
    AND notification_email != '';

    -- Exit if no email configured
    IF v_email IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Get context
    SELECT name INTO v_app_name FROM public.customer_apps WHERE id = p_app_id;
    SELECT first_name || ' ' || last_name INTO v_member_name
    FROM public.app_members WHERE id = p_member_id;

    -- Build email
    v_subject := '🚨 Support Escalation - ' || COALESCE(v_app_name, 'Your App');
    v_body := 'A customer needs your attention.\n\n' ||
        'Customer: ' || COALESCE(v_member_name, 'Unknown') || '\n' ||
        'Reason: ' || REPLACE(p_escalation_reason, '_', ' ') || '\n' ||
        'Message: ' || LEFT(p_customer_message, 500) || '\n\n' ||
        'View ticket: https://royaltyapp.ai/app/support.html?ticket=' || p_ticket_id::TEXT;

    -- Queue the email
    INSERT INTO public.email_notification_queue (to_email, subject, body, template, template_data)
    VALUES (
        v_email,
        v_subject,
        v_body,
        'escalation',
        jsonb_build_object(
            'app_name', v_app_name,
            'member_name', v_member_name,
            'escalation_reason', p_escalation_reason,
            'customer_message', LEFT(p_customer_message, 500),
            'ticket_id', p_ticket_id
        )
    );

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION queue_escalation_email TO service_role;

-- B35: get_my_tickets
CREATE OR REPLACE FUNCTION get_my_tickets(
    p_member_id UUID,
    p_app_id UUID
)
RETURNS TABLE (
    id UUID,
    ticket_number TEXT,
    subject TEXT,
    status TEXT,
    priority TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    last_message_at TIMESTAMPTZ,
    unread_count BIGINT,
    last_message_preview TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.ticket_number,
        t.subject,
        t.status,
        t.priority,
        t.created_at,
        t.updated_at,
        (SELECT MAX(tm.created_at) FROM public.ticket_messages tm WHERE tm.ticket_id = t.id) as last_message_at,
        (
            SELECT COUNT(*)::BIGINT
            FROM public.ticket_messages tm
            WHERE tm.ticket_id = t.id
              AND tm.sender_type IN ('staff', 'ai')
              AND tm.created_at > COALESCE(t.customer_last_read_at, t.created_at)
        ) as unread_count,
        (
            SELECT LEFT(tm.message, 100)
            FROM public.ticket_messages tm
            WHERE tm.ticket_id = t.id
            ORDER BY tm.created_at DESC
            LIMIT 1
        ) as last_message_preview
    FROM public.support_tickets t
    WHERE t.member_id = p_member_id
      AND t.app_id = p_app_id
    ORDER BY t.updated_at DESC
    LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_tickets(UUID, UUID) TO anon, authenticated;

-- B36: get_ticket_messages_for_customer
CREATE OR REPLACE FUNCTION get_ticket_messages_for_customer(
    p_ticket_id UUID,
    p_member_id UUID
)
RETURNS TABLE (
    id UUID,
    sender_type TEXT,
    sender_name TEXT,
    message TEXT,
    created_at TIMESTAMPTZ,
    is_from_me BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ticket_exists BOOLEAN;
BEGIN
    -- Verify ticket belongs to this member
    SELECT EXISTS (
        SELECT 1 FROM public.support_tickets
        WHERE id = p_ticket_id AND member_id = p_member_id
    ) INTO v_ticket_exists;

    IF NOT v_ticket_exists THEN
        RAISE EXCEPTION 'Ticket not found or access denied';
    END IF;

    -- Update last read timestamp
    UPDATE public.support_tickets
    SET customer_last_read_at = NOW()
    WHERE id = p_ticket_id;

    -- Return messages (exclude internal notes)
    RETURN QUERY
    SELECT
        tm.id,
        tm.sender_type,
        COALESCE(tm.sender_name,
            CASE tm.sender_type
                WHEN 'staff' THEN 'Support Team'
                WHEN 'ai' THEN 'Support'
                WHEN 'customer' THEN 'You'
                ELSE 'System'
            END
        ) as sender_name,
        tm.message,
        tm.created_at,
        (tm.sender_type = 'customer') as is_from_me
    FROM public.ticket_messages tm
    WHERE tm.ticket_id = p_ticket_id
      AND tm.is_internal = false
    ORDER BY tm.created_at ASC
    LIMIT 100;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ticket_messages_for_customer(UUID, UUID) TO anon, authenticated;

-- B37: customer_reply_to_ticket
CREATE OR REPLACE FUNCTION customer_reply_to_ticket(
    p_ticket_id UUID,
    p_member_id UUID,
    p_message TEXT
)
RETURNS TABLE (
    success BOOLEAN,
    message_id UUID,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ticket RECORD;
    v_member RECORD;
    v_message_id UUID;
BEGIN
    -- Validate message
    IF p_message IS NULL OR LENGTH(TRIM(p_message)) = 0 THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Message cannot be empty'::TEXT;
        RETURN;
    END IF;

    IF LENGTH(p_message) > 5000 THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Message too long (max 5000 characters)'::TEXT;
        RETURN;
    END IF;

    -- Get ticket and verify ownership
    SELECT * INTO v_ticket
    FROM public.support_tickets
    WHERE id = p_ticket_id AND member_id = p_member_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Ticket not found or access denied'::TEXT;
        RETURN;
    END IF;

    -- Get member info for sender name
    SELECT first_name, last_name INTO v_member
    FROM public.app_members
    WHERE id = p_member_id;

    -- Insert message
    INSERT INTO public.ticket_messages (
        ticket_id,
        sender_type,
        sender_id,
        sender_name,
        message
    ) VALUES (
        p_ticket_id,
        'customer',
        p_member_id,
        COALESCE(v_member.first_name || ' ' || v_member.last_name, 'Customer'),
        TRIM(p_message)
    )
    RETURNING id INTO v_message_id;

    -- Update ticket status to awaiting response if it was pending customer
    UPDATE public.support_tickets
    SET
        status = CASE
            WHEN status = 'pending_customer' THEN 'awaiting_response'
            WHEN status IN ('resolved', 'closed') THEN 'open'
            ELSE status
        END,
        updated_at = NOW()
    WHERE id = p_ticket_id;

    RETURN QUERY SELECT true, v_message_id, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION customer_reply_to_ticket(UUID, UUID, TEXT) TO anon, authenticated;

-- B38: get_customer_unread_count
CREATE OR REPLACE FUNCTION get_customer_unread_count(
    p_member_id UUID,
    p_app_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.support_tickets t
    WHERE t.member_id = p_member_id
      AND t.app_id = p_app_id
      AND EXISTS (
          SELECT 1
          FROM public.ticket_messages tm
          WHERE tm.ticket_id = t.id
            AND tm.sender_type IN ('staff', 'ai')
            AND tm.created_at > COALESCE(t.customer_last_read_at, t.created_at)
      );

    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION get_customer_unread_count(UUID, UUID) TO anon, authenticated;

-- B39: get_ticket_ai_history
CREATE OR REPLACE FUNCTION get_ticket_ai_history(
    p_ticket_id UUID,
    p_member_id UUID
)
RETURNS TABLE (
    id UUID,
    role TEXT,
    content TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_session_id UUID;
BEGIN
    -- Get AI session ID from ticket metadata
    SELECT (metadata->>'ai_session_id')::UUID INTO v_session_id
    FROM public.support_tickets
    WHERE id = p_ticket_id AND member_id = p_member_id;

    IF v_session_id IS NULL THEN
        -- No AI history for this ticket
        RETURN;
    END IF;

    -- Return AI conversation messages
    RETURN QUERY
    SELECT
        m.id,
        m.role,
        m.content,
        m.created_at
    FROM public.ai_support_messages m
    WHERE m.session_id = v_session_id
    ORDER BY m.created_at ASC
    LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ticket_ai_history(UUID, UUID) TO anon, authenticated;

-- B40: create_ticket_from_ai_chat
CREATE OR REPLACE FUNCTION create_ticket_from_ai_chat(
    p_app_id UUID,
    p_member_id UUID,
    p_session_id UUID,
    p_subject TEXT,
    p_description TEXT,
    p_escalation_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    ticket_id UUID,
    ticket_number TEXT,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id UUID;
    v_ticket_number TEXT;
    v_ticket_id UUID;
BEGIN
    -- Get organization from app
    SELECT organization_id INTO v_org_id
    FROM public.customer_apps
    WHERE id = p_app_id;

    IF v_org_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'App not found'::TEXT;
        RETURN;
    END IF;

    -- Generate ticket number
    SELECT generate_ticket_number(p_app_id) INTO v_ticket_number;

    -- Create ticket
    INSERT INTO public.support_tickets (
        app_id,
        organization_id,
        member_id,
        ticket_number,
        subject,
        description,
        ticket_type,
        priority,
        status,
        requires_human,
        escalation_reason,
        source,
        metadata
    ) VALUES (
        p_app_id,
        v_org_id,
        p_member_id,
        v_ticket_number,
        p_subject,
        p_description,
        'question',
        CASE
            WHEN p_escalation_reason IN ('escalation_keyword', 'requires_human_action') THEN 'high'
            ELSE 'normal'
        END,
        'escalated',
        true,
        p_escalation_reason,
        'ai_support',
        jsonb_build_object('ai_session_id', p_session_id)
    )
    RETURNING id INTO v_ticket_id;

    RETURN QUERY SELECT true, v_ticket_id, v_ticket_number, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION create_ticket_from_ai_chat(UUID, UUID, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;

-- B41: delete_user_account
CREATE OR REPLACE FUNCTION delete_user_account(p_user_id UUID)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT,
    deleted_counts JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_ids UUID[];
    v_owned_org_ids UUID[];
    v_app_ids UUID[];
    v_project_ids UUID[];
    v_counts JSONB := '{}'::JSONB;
    v_count INTEGER;
BEGIN
    -- Verify the user exists
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RETURN QUERY SELECT false, 'User not found'::TEXT, '{}'::JSONB;
        RETURN;
    END IF;

    -- Get all organizations the user is a member of
    SELECT ARRAY_AGG(organization_id) INTO v_org_ids
    FROM public.organization_members
    WHERE user_id = p_user_id;

    -- Get organizations where user is the ONLY owner (these will be deleted)
    SELECT ARRAY_AGG(om.organization_id) INTO v_owned_org_ids
    FROM public.organization_members om
    WHERE om.user_id = p_user_id
      AND om.role = 'owner'
      AND NOT EXISTS (
          SELECT 1 FROM public.organization_members om2
          WHERE om2.organization_id = om.organization_id
            AND om2.role = 'owner'
            AND om2.user_id != p_user_id
      );

    -- If user owns organizations that will be deleted, get their apps and projects
    IF v_owned_org_ids IS NOT NULL AND array_length(v_owned_org_ids, 1) > 0 THEN
        -- Get all customer apps for owned orgs
        SELECT ARRAY_AGG(id) INTO v_app_ids
        FROM public.customer_apps
        WHERE organization_id = ANY(v_owned_org_ids);

        -- Get all projects for owned orgs
        SELECT ARRAY_AGG(id) INTO v_project_ids
        FROM public.projects
        WHERE organization_id = ANY(v_owned_org_ids);

        -- Delete app-related data (order matters for foreign keys)
        IF v_app_ids IS NOT NULL AND array_length(v_app_ids, 1) > 0 THEN
            DELETE FROM public.ticket_messages WHERE ticket_id IN (
                SELECT id FROM public.support_tickets WHERE app_id = ANY(v_app_ids)
            );
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('ticket_messages', v_count);

            DELETE FROM public.support_tickets WHERE app_id = ANY(v_app_ids);
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('support_tickets', v_count);

            DELETE FROM public.ai_support_messages WHERE session_id IN (
                SELECT id FROM public.ai_support_sessions WHERE app_id = ANY(v_app_ids)
            );
            DELETE FROM public.ai_support_sessions WHERE app_id = ANY(v_app_ids);

            DELETE FROM public.reward_redemptions WHERE app_id = ANY(v_app_ids);
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('reward_redemptions', v_count);

            DELETE FROM public.app_rewards WHERE app_id = ANY(v_app_ids);
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('app_rewards', v_count);

            DELETE FROM public.points_transactions WHERE app_id = ANY(v_app_ids);
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('points_transactions', v_count);

            DELETE FROM public.member_visits WHERE app_id = ANY(v_app_ids);
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('member_visits', v_count);

            DELETE FROM public.app_events WHERE app_id = ANY(v_app_ids);
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('app_events', v_count);

            DELETE FROM public.app_announcements WHERE app_id = ANY(v_app_ids);
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('app_announcements', v_count);

            DELETE FROM public.app_members WHERE app_id = ANY(v_app_ids);
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('app_members', v_count);

            DELETE FROM public.automated_campaigns WHERE app_id = ANY(v_app_ids);
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('automated_campaigns', v_count);

            DELETE FROM public.customer_apps WHERE id = ANY(v_app_ids);
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('customer_apps', v_count);
        END IF;

        -- Delete project-related data
        IF v_project_ids IS NOT NULL AND array_length(v_project_ids, 1) > 0 THEN
            DELETE FROM public.opportunities WHERE project_id = ANY(v_project_ids);
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('opportunities', v_count);

            DELETE FROM public.project_customers WHERE project_id = ANY(v_project_ids);

            DELETE FROM public.blog_posts WHERE automation_id IN (
                SELECT id FROM public.automations WHERE project_id = ANY(v_project_ids)
            );
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('blog_posts', v_count);

            DELETE FROM public.automations WHERE project_id = ANY(v_project_ids);
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('automations', v_count);

            DELETE FROM public.projects WHERE id = ANY(v_project_ids);
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_counts := v_counts || jsonb_build_object('projects', v_count);
        END IF;

        -- Delete organization-level data
        DELETE FROM public.customers WHERE organization_id = ANY(v_owned_org_ids);
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('customers', v_count);

        DELETE FROM public.custom_fields WHERE organization_id = ANY(v_owned_org_ids);
        DELETE FROM public.csv_imports WHERE organization_id = ANY(v_owned_org_ids);

        DELETE FROM public.ai_recommendations WHERE organization_id = ANY(v_owned_org_ids);
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('ai_recommendations', v_count);

        DELETE FROM public.ai_actions_log WHERE organization_id = ANY(v_owned_org_ids);
        DELETE FROM public.ai_analysis_history WHERE organization_id = ANY(v_owned_org_ids);
        DELETE FROM public.audit_logs WHERE organization_id = ANY(v_owned_org_ids);
        DELETE FROM public.newsletter_articles WHERE organization_id = ANY(v_owned_org_ids);
        DELETE FROM public.content_strategies WHERE organization_id = ANY(v_owned_org_ids);

        DELETE FROM public.organization_members WHERE organization_id = ANY(v_owned_org_ids);

        DELETE FROM public.organizations WHERE id = ANY(v_owned_org_ids);
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('organizations', v_count);
    END IF;

    -- Remove user from organizations they don't solely own
    DELETE FROM public.organization_members WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('memberships_removed', v_count);

    -- Delete user's feature requests
    DELETE FROM public.feature_requests WHERE submitted_by = p_user_id;

    -- Delete user's roadmap votes
    DELETE FROM public.roadmap_votes WHERE user_id = p_user_id;

    -- Delete the user's profile
    DELETE FROM public.profiles WHERE id = p_user_id;
    v_counts := v_counts || jsonb_build_object('profile_deleted', true);

    RETURN QUERY SELECT true, 'Account and all associated data deleted successfully'::TEXT, v_counts;

EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT false, ('Error deleting account: ' || SQLERRM)::TEXT, '{}'::JSONB;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_user_account(UUID) TO authenticated;

-- B42: delete_my_account
CREATE OR REPLACE FUNCTION delete_my_account()
RETURNS TABLE (
    success BOOLEAN,
    message TEXT,
    deleted_counts JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Verify user is authenticated
    IF auth.uid() IS NULL THEN
        RETURN QUERY SELECT false, 'Not authenticated'::TEXT, '{}'::JSONB;
        RETURN;
    END IF;

    -- Call the main deletion function with the current user's ID
    RETURN QUERY SELECT * FROM delete_user_account(auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION delete_my_account() TO authenticated;

-- B43: export_my_data
CREATE OR REPLACE FUNCTION export_my_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_org_ids UUID[];
    v_result JSONB := '{}'::JSONB;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('error', 'Not authenticated');
    END IF;

    -- Get user's organizations
    SELECT ARRAY_AGG(organization_id) INTO v_org_ids
    FROM public.organization_members
    WHERE user_id = v_user_id;

    -- Export profile
    SELECT jsonb_build_object('profile', row_to_json(p))
    INTO v_result
    FROM public.profiles p
    WHERE p.id = v_user_id;

    -- Export organizations
    v_result := v_result || jsonb_build_object(
        'organizations',
        COALESCE((
            SELECT jsonb_agg(row_to_json(o))
            FROM public.organizations o
            WHERE o.id = ANY(v_org_ids)
        ), '[]'::JSONB)
    );

    -- Export customers (if org owner)
    v_result := v_result || jsonb_build_object(
        'customers',
        COALESCE((
            SELECT jsonb_agg(row_to_json(c))
            FROM public.customers c
            WHERE c.organization_id = ANY(v_org_ids)
        ), '[]'::JSONB)
    );

    -- Export customer apps
    v_result := v_result || jsonb_build_object(
        'customer_apps',
        COALESCE((
            SELECT jsonb_agg(row_to_json(ca))
            FROM public.customer_apps ca
            WHERE ca.organization_id = ANY(v_org_ids)
        ), '[]'::JSONB)
    );

    -- Export projects
    v_result := v_result || jsonb_build_object(
        'projects',
        COALESCE((
            SELECT jsonb_agg(row_to_json(p))
            FROM public.projects p
            WHERE p.organization_id = ANY(v_org_ids)
        ), '[]'::JSONB)
    );

    v_result := v_result || jsonb_build_object(
        'exported_at', NOW(),
        'user_id', v_user_id
    );

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION export_my_data() TO authenticated;

-- B44: get_current_usage
CREATE OR REPLACE FUNCTION get_current_usage(org_id UUID)
RETURNS public.usage_tracking
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    current_period_start DATE;
    current_period_end DATE;
    usage_record public.usage_tracking;
BEGIN
    -- Calculate current month boundaries
    current_period_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;
    current_period_end := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

    -- Try to get existing record
    SELECT * INTO usage_record
    FROM public.usage_tracking
    WHERE organization_id = org_id
    AND period_start = current_period_start;

    -- Create if doesn't exist
    IF NOT FOUND THEN
        INSERT INTO public.usage_tracking (organization_id, period_start, period_end)
        VALUES (org_id, current_period_start, current_period_end)
        RETURNING * INTO usage_record;
    END IF;

    RETURN usage_record;
END;
$$;

-- B45: increment_usage
CREATE OR REPLACE FUNCTION increment_usage(
    org_id UUID,
    usage_type TEXT,
    amount INTEGER DEFAULT 1
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    current_period_start DATE;
BEGIN
    current_period_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;

    -- Ensure usage record exists
    PERFORM get_current_usage(org_id);

    -- Increment the appropriate counter
    IF usage_type = 'emails' THEN
        UPDATE public.usage_tracking
        SET emails_sent = emails_sent + amount, updated_at = NOW()
        WHERE organization_id = org_id AND period_start = current_period_start;
    ELSIF usage_type = 'sms' THEN
        UPDATE public.usage_tracking
        SET sms_sent = sms_sent + amount, updated_at = NOW()
        WHERE organization_id = org_id AND period_start = current_period_start;
    ELSIF usage_type = 'ai_analyses' THEN
        UPDATE public.usage_tracking
        SET ai_analyses_used = ai_analyses_used + amount, updated_at = NOW()
        WHERE organization_id = org_id AND period_start = current_period_start;
    END IF;

    RETURN TRUE;
END;
$$;

-- B46: update_usage_snapshots
CREATE OR REPLACE FUNCTION update_usage_snapshots(org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    current_period_start DATE;
    proj_count INTEGER;
    auto_count INTEGER;
    cust_count INTEGER;
BEGIN
    current_period_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;

    -- Ensure usage record exists
    PERFORM get_current_usage(org_id);

    -- Count projects
    SELECT COUNT(*) INTO proj_count
    FROM public.projects WHERE organization_id = org_id;

    -- Count automations (via projects)
    SELECT COUNT(*) INTO auto_count
    FROM public.automations a
    JOIN public.projects p ON a.project_id = p.id
    WHERE p.organization_id = org_id;

    -- Count customers
    SELECT COUNT(*) INTO cust_count
    FROM public.customers WHERE organization_id = org_id;

    -- Update snapshot
    UPDATE public.usage_tracking
    SET
        projects_count = proj_count,
        automations_count = auto_count,
        customers_count = cust_count,
        updated_at = NOW()
    WHERE organization_id = org_id AND period_start = current_period_start;

    RETURN TRUE;
END;
$$;

-- B47: redeem_appsumo_code
CREATE OR REPLACE FUNCTION redeem_appsumo_code(
    org_id UUID,
    code_to_redeem TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    code_record public.appsumo_codes;
    current_tier INTEGER;
    current_codes TEXT[];
    new_tier INTEGER;
BEGIN
    -- Find the code
    SELECT * INTO code_record
    FROM public.appsumo_codes
    WHERE code = code_to_redeem;

    -- Check if code exists
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid code');
    END IF;

    -- Check if already redeemed
    IF code_record.is_redeemed THEN
        RETURN jsonb_build_object('success', false, 'error', 'Code already redeemed');
    END IF;

    -- Get current org state
    SELECT appsumo_tier, appsumo_codes INTO current_tier, current_codes
    FROM public.organizations
    WHERE id = org_id;

    -- Calculate new tier (stacking: tier = sum of code tiers, max 3)
    IF current_tier IS NULL THEN
        new_tier := code_record.tier;
    ELSE
        new_tier := LEAST(current_tier + code_record.tier, 3);
    END IF;

    -- Mark code as redeemed
    UPDATE public.appsumo_codes
    SET is_redeemed = TRUE, redeemed_by_org_id = org_id, redeemed_at = NOW()
    WHERE id = code_record.id;

    -- Update organization
    UPDATE public.organizations
    SET
        plan_type = 'appsumo_lifetime',
        appsumo_tier = new_tier,
        appsumo_codes = array_append(COALESCE(current_codes, '{}'), code_to_redeem),
        plan_changed_at = NOW()
    WHERE id = org_id;

    RETURN jsonb_build_object(
        'success', true,
        'tier', new_tier,
        'message', 'Code redeemed successfully! Your plan has been upgraded to Tier ' || new_tier
    );
END;
$$;

-- B48: check_appsumo_code
CREATE OR REPLACE FUNCTION check_appsumo_code(code_to_check TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    code_record public.appsumo_codes;
BEGIN
    SELECT * INTO code_record
    FROM public.appsumo_codes
    WHERE code = code_to_check;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Code not found');
    END IF;

    IF code_record.is_redeemed THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Code already redeemed');
    END IF;

    RETURN jsonb_build_object('valid', true, 'tier', code_record.tier);
END;
$$;


-- #####################################################
-- SECTION C: SECURITY INVOKER FUNCTIONS
-- These functions run with the CALLER's permissions.
-- No SET search_path, no public. prefix needed.
-- #####################################################

-- C1: create_industry_fields
CREATE OR REPLACE FUNCTION create_industry_fields(org_id UUID, industry TEXT)
RETURNS void AS $$
BEGIN
    -- Universal fields for all industries
    INSERT INTO custom_fields (organization_id, name, field_key, field_type, is_industry_standard, display_order) VALUES
        (org_id, 'Customer Since', 'customer_since', 'date', true, 1),
        (org_id, 'Lifetime Value', 'lifetime_value', 'number', true, 2),
        (org_id, 'Last Purchase Date', 'last_purchase_date', 'date', true, 3),
        (org_id, 'Total Orders', 'total_orders', 'number', true, 4)
    ON CONFLICT DO NOTHING;

    -- Industry-specific fields
    IF industry = 'food' THEN
        INSERT INTO custom_fields (organization_id, name, field_key, field_type, options, is_industry_standard, display_order) VALUES
            (org_id, 'Dietary Restrictions', 'dietary_restrictions', 'select', '["None", "Vegetarian", "Vegan", "Gluten-Free", "Halal", "Kosher", "Other"]'::jsonb, true, 10),
            (org_id, 'Favorite Items', 'favorite_items', 'text', null, true, 11),
            (org_id, 'Loyalty Points', 'loyalty_points', 'number', null, true, 12)
        ON CONFLICT DO NOTHING;
    ELSIF industry = 'health' THEN
        INSERT INTO custom_fields (organization_id, name, field_key, field_type, options, is_industry_standard, display_order) VALUES
            (org_id, 'Membership Type', 'membership_type', 'select', '["Basic", "Premium", "VIP", "Corporate"]'::jsonb, true, 10),
            (org_id, 'Health Goals', 'health_goals', 'text', null, true, 11),
            (org_id, 'Insurance Provider', 'insurance_provider', 'text', null, true, 12)
        ON CONFLICT DO NOTHING;
    ELSIF industry = 'service' THEN
        INSERT INTO custom_fields (organization_id, name, field_key, field_type, is_industry_standard, display_order) VALUES
            (org_id, 'Contract Value', 'contract_value', 'number', true, 10),
            (org_id, 'Renewal Date', 'renewal_date', 'date', true, 11),
            (org_id, 'NPS Score', 'nps_score', 'number', true, 12)
        ON CONFLICT DO NOTHING;
    ELSIF industry = 'retail' THEN
        INSERT INTO custom_fields (organization_id, name, field_key, field_type, is_industry_standard, display_order) VALUES
            (org_id, 'Preferred Categories', 'preferred_categories', 'text', true, 10),
            (org_id, 'Returns Rate', 'returns_rate', 'number', true, 11),
            (org_id, 'Wishlist Items', 'wishlist_items', 'text', true, 12)
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- C2: get_pending_recommendations
CREATE OR REPLACE FUNCTION get_pending_recommendations(org_id UUID, limit_count INTEGER DEFAULT 10)
RETURNS TABLE (
    id UUID,
    recommendation_type TEXT,
    title TEXT,
    description TEXT,
    confidence_score DECIMAL,
    potential_impact TEXT,
    suggested_action TEXT,
    action_type TEXT,
    action_payload JSONB,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ar.id,
        ar.recommendation_type,
        ar.title,
        ar.description,
        ar.confidence_score,
        ar.potential_impact,
        ar.suggested_action,
        ar.action_type,
        ar.action_payload,
        ar.created_at
    FROM ai_recommendations ar
    WHERE ar.organization_id = org_id
      AND ar.status = 'pending'
    ORDER BY
        CASE ar.potential_impact
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 3
        END,
        ar.confidence_score DESC,
        ar.created_at DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- C3: dismiss_recommendation
CREATE OR REPLACE FUNCTION dismiss_recommendation(rec_id UUID, user_feedback TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE ai_recommendations
    SET status = 'dismissed',
        dismissed_at = NOW(),
        feedback = COALESCE(user_feedback, feedback)
    WHERE id = rec_id
      AND EXISTS (
          SELECT 1 FROM organization_members om
          WHERE om.organization_id = ai_recommendations.organization_id
          AND om.user_id = auth.uid()
      );

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- C4: implement_recommendation
CREATE OR REPLACE FUNCTION implement_recommendation(rec_id UUID, user_feedback TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE ai_recommendations
    SET status = 'implemented',
        implemented_at = NOW(),
        feedback = COALESCE(user_feedback, feedback)
    WHERE id = rec_id
      AND EXISTS (
          SELECT 1 FROM organization_members om
          WHERE om.organization_id = ai_recommendations.organization_id
          AND om.user_id = auth.uid()
      );

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- C5: get_org_analysis_data
CREATE OR REPLACE FUNCTION get_org_analysis_data(org_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    org_record RECORD;
    customer_stats JSONB;
    project_stats JSONB;
    automation_stats JSONB;
BEGIN
    -- Get org info
    SELECT * INTO org_record FROM organizations WHERE id = org_id;

    -- Customer statistics
    SELECT jsonb_build_object(
        'total', COUNT(*),
        'recent_30_days', COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days'),
        'by_source', jsonb_object_agg(COALESCE(source, 'unknown'), cnt)
    ) INTO customer_stats
    FROM (
        SELECT source, COUNT(*) as cnt
        FROM customers
        WHERE organization_id = org_id AND deleted_at IS NULL
        GROUP BY source
    ) sub;

    -- Project statistics
    SELECT jsonb_build_object(
        'total', COUNT(*),
        'by_industry', jsonb_object_agg(COALESCE(industry, 'unset'), cnt)
    ) INTO project_stats
    FROM (
        SELECT industry, COUNT(*) as cnt
        FROM projects
        WHERE organization_id = org_id AND deleted_at IS NULL
        GROUP BY industry
    ) sub;

    -- Automation statistics
    SELECT jsonb_build_object(
        'total', COUNT(*),
        'active', COUNT(*) FILTER (WHERE is_active = true),
        'by_type', jsonb_object_agg(COALESCE(type, 'other'), cnt)
    ) INTO automation_stats
    FROM (
        SELECT a.type, COUNT(*) as cnt
        FROM automations a
        JOIN projects p ON p.id = a.project_id
        WHERE p.organization_id = org_id
          AND p.deleted_at IS NULL
          AND a.deleted_at IS NULL
        GROUP BY a.type
    ) sub;

    -- Build result
    result := jsonb_build_object(
        'organization', jsonb_build_object(
            'name', org_record.name,
            'created_at', org_record.created_at,
            'plan_type', COALESCE(org_record.plan_type, 'free')
        ),
        'customers', COALESCE(customer_stats, '{}'::jsonb),
        'projects', COALESCE(project_stats, '{}'::jsonb),
        'automations', COALESCE(automation_stats, '{}'::jsonb)
    );

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- C6: get_ai_weekly_summary
CREATE OR REPLACE FUNCTION get_ai_weekly_summary(p_app_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    week_start TIMESTAMPTZ := NOW() - INTERVAL '7 days';
BEGIN
    SELECT jsonb_build_object(
        'total_actions', COUNT(*),
        'by_type', (
            SELECT jsonb_object_agg(action_type, cnt)
            FROM (
                SELECT action_type, COUNT(*) as cnt
                FROM ai_actions_log
                WHERE app_id = p_app_id AND created_at > week_start
                GROUP BY action_type
            ) sub
        ),
        'conversions', COUNT(*) FILTER (WHERE result = 'converted'),
        'period_start', week_start,
        'period_end', NOW()
    ) INTO result
    FROM ai_actions_log
    WHERE app_id = p_app_id AND created_at > week_start;

    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- C7: get_app_stats
CREATE OR REPLACE FUNCTION get_app_stats(p_app_id UUID)
RETURNS TABLE (
    total_members BIGINT,
    new_members_this_month BIGINT,
    total_points_issued BIGINT,
    total_points_redeemed BIGINT,
    total_redemptions BIGINT,
    pending_redemptions BIGINT
) AS $$
DECLARE
    start_of_month TIMESTAMPTZ;
BEGIN
    start_of_month := date_trunc('month', NOW());

    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM app_members WHERE app_id = p_app_id AND deleted_at IS NULL)::BIGINT,
        (SELECT COUNT(*) FROM app_members WHERE app_id = p_app_id AND deleted_at IS NULL AND joined_at >= start_of_month)::BIGINT,
        COALESCE((SELECT SUM(points_change) FROM points_transactions WHERE app_id = p_app_id AND points_change > 0), 0)::BIGINT,
        COALESCE((SELECT SUM(ABS(points_change)) FROM points_transactions WHERE app_id = p_app_id AND points_change < 0), 0)::BIGINT,
        (SELECT COUNT(*) FROM reward_redemptions WHERE app_id = p_app_id)::BIGINT,
        (SELECT COUNT(*) FROM reward_redemptions WHERE app_id = p_app_id AND status IN ('pending', 'confirmed'))::BIGINT;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

GRANT EXECUTE ON FUNCTION get_app_stats(UUID) TO authenticated;

-- C8: get_support_stats
CREATE OR REPLACE FUNCTION get_support_stats(p_app_id UUID)
RETURNS TABLE (
    open_tickets BIGINT,
    pending_response BIGINT,
    escalated_tickets BIGINT,
    avg_response_time_hours NUMERIC,
    avg_resolution_time_hours NUMERIC,
    satisfaction_avg NUMERIC,
    ai_resolution_rate NUMERIC,
    total_ai_sessions BIGINT,
    total_tickets_this_month BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::BIGINT as open_tickets,
        COUNT(*) FILTER (WHERE status = 'awaiting_response')::BIGINT as pending_response,
        COUNT(*) FILTER (WHERE requires_human = true AND status NOT IN ('resolved', 'closed'))::BIGINT as escalated_tickets,
        ROUND(AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 3600)::NUMERIC, 1) as avg_response_time_hours,
        ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)::NUMERIC, 1) as avg_resolution_time_hours,
        ROUND(AVG(satisfaction_rating)::NUMERIC, 1) as satisfaction_avg,
        ROUND(
            (COUNT(*) FILTER (WHERE ai_handled = true AND requires_human = false)::NUMERIC /
             NULLIF(COUNT(*) FILTER (WHERE ai_handled = true)::NUMERIC, 0)) * 100,
            1
        ) as ai_resolution_rate,
        (SELECT COUNT(*) FROM ai_support_sessions WHERE ai_support_sessions.app_id = p_app_id)::BIGINT as total_ai_sessions,
        COUNT(*) FILTER (WHERE created_at > date_trunc('month', NOW()))::BIGINT as total_tickets_this_month
    FROM support_tickets
    WHERE app_id = p_app_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

GRANT EXECUTE ON FUNCTION get_support_stats(UUID) TO authenticated;

-- C9: get_app_dashboard_summary (LATEST from dashboard-reporting-fix.sql - uses joined_at)
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
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- C10: get_member_growth (LATEST from dashboard-reporting-fix.sql - uses joined_at)
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
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- C11: get_recent_activity (LATEST from dashboard-reporting-fix.sql - uses joined_at)
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
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- C12: get_visit_trend
CREATE OR REPLACE FUNCTION get_visit_trend(p_app_id UUID, p_days INTEGER DEFAULT 30)
RETURNS TABLE (
    date DATE,
    visit_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH daily_visits AS (
        SELECT
            DATE(visited_at) as day,
            COUNT(*) as visits
        FROM member_visits
        WHERE app_id = p_app_id
        AND visited_at > NOW() - (p_days || ' days')::INTERVAL
        GROUP BY DATE(visited_at)
    ),
    all_days AS (
        SELECT d::date as day
        FROM generate_series(
            (NOW() - (p_days || ' days')::INTERVAL)::date,
            CURRENT_DATE,
            '1 day'::interval
        ) d
    )
    SELECT
        ad.day as date,
        COALESCE(dv.visits, 0) as visit_count
    FROM all_days ad
    LEFT JOIN daily_visits dv ON dv.day = ad.day
    ORDER BY ad.day;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- C13: get_org_dashboard_summary (from dashboard-reporting-fix.sql)
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
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- C14: get_published_articles
CREATE OR REPLACE FUNCTION get_published_articles(
    p_app_id UUID,
    p_language TEXT DEFAULT 'en',
    p_topic TEXT DEFAULT NULL,
    p_series_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_articles JSONB;
    v_total INTEGER;
BEGIN
    -- Get total count
    SELECT COUNT(*) INTO v_total
    FROM newsletter_articles
    WHERE app_id = p_app_id
      AND language = p_language
      AND status = 'published'
      AND deleted_at IS NULL
      AND (p_topic IS NULL OR primary_topic = p_topic)
      AND (p_series_id IS NULL OR series_id = p_series_id);

    -- Get articles
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'title', a.title,
            'slug', a.slug,
            'excerpt', a.excerpt,
            'og_image_url', a.og_image_url,
            'primary_topic', a.primary_topic,
            'tags', a.tags,
            'published_at', a.published_at,
            'series', CASE WHEN a.series_id IS NOT NULL THEN
                jsonb_build_object(
                    'id', s.id,
                    'title', s.title,
                    'slug', s.slug,
                    'order', a.series_order
                )
            ELSE NULL END
        ) ORDER BY a.published_at DESC
    ) INTO v_articles
    FROM newsletter_articles a
    LEFT JOIN article_series s ON a.series_id = s.id
    WHERE a.app_id = p_app_id
      AND a.language = p_language
      AND a.status = 'published'
      AND a.deleted_at IS NULL
      AND (p_topic IS NULL OR a.primary_topic = p_topic)
      AND (p_series_id IS NULL OR a.series_id = p_series_id)
    LIMIT p_limit
    OFFSET p_offset;

    RETURN jsonb_build_object(
        'articles', COALESCE(v_articles, '[]'::jsonb),
        'total', v_total,
        'limit', p_limit,
        'offset', p_offset
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_published_articles TO anon, authenticated;

-- C15: get_article_by_slug
CREATE OR REPLACE FUNCTION get_article_by_slug(
    p_app_id UUID,
    p_slug TEXT,
    p_language TEXT DEFAULT 'en'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_article newsletter_articles%ROWTYPE;
    v_result JSONB;
    v_series JSONB;
    v_prev_in_series JSONB;
    v_next_in_series JSONB;
    v_related JSONB;
    v_translations JSONB;
BEGIN
    -- Get article
    SELECT * INTO v_article
    FROM newsletter_articles
    WHERE app_id = p_app_id
      AND slug = p_slug
      AND language = p_language
      AND status = 'published'
      AND deleted_at IS NULL;

    IF v_article.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Article not found'
        );
    END IF;

    -- Get series info if part of series
    IF v_article.series_id IS NOT NULL THEN
        SELECT jsonb_build_object(
            'id', s.id,
            'title', s.title,
            'slug', s.slug,
            'article_count', s.article_count
        ) INTO v_series
        FROM article_series s
        WHERE s.id = v_article.series_id;

        -- Get prev/next in series
        SELECT jsonb_build_object(
            'title', title,
            'slug', slug
        ) INTO v_prev_in_series
        FROM newsletter_articles
        WHERE series_id = v_article.series_id
          AND series_order = v_article.series_order - 1
          AND language = p_language
          AND status = 'published'
          AND deleted_at IS NULL;

        SELECT jsonb_build_object(
            'title', title,
            'slug', slug
        ) INTO v_next_in_series
        FROM newsletter_articles
        WHERE series_id = v_article.series_id
          AND series_order = v_article.series_order + 1
          AND language = p_language
          AND status = 'published'
          AND deleted_at IS NULL;
    END IF;

    -- Get related articles
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'title', a.title,
            'slug', a.slug,
            'excerpt', a.excerpt,
            'og_image_url', a.og_image_url
        )
    ) INTO v_related
    FROM newsletter_articles a
    WHERE a.app_id = p_app_id
      AND a.language = p_language
      AND a.status = 'published'
      AND a.deleted_at IS NULL
      AND a.id != v_article.id
      AND (
          a.id = ANY(v_article.related_article_ids)
          OR a.primary_topic = v_article.primary_topic
          OR a.tags && v_article.tags
      )
    LIMIT 5;

    -- Get translations
    SELECT jsonb_agg(
        jsonb_build_object(
            'language', a.language,
            'slug', a.slug,
            'title', a.title
        )
    ) INTO v_translations
    FROM newsletter_articles a
    WHERE a.status = 'published'
      AND a.deleted_at IS NULL
      AND (
          (v_article.is_primary_language AND a.primary_article_id = v_article.id)
          OR (NOT v_article.is_primary_language AND (a.id = v_article.primary_article_id OR a.primary_article_id = v_article.primary_article_id))
      )
      AND a.id != v_article.id;

    -- Build result
    v_result := jsonb_build_object(
        'success', true,
        'article', jsonb_build_object(
            'id', v_article.id,
            'title', v_article.title,
            'slug', v_article.slug,
            'excerpt', v_article.excerpt,
            'content', v_article.content,
            'content_html', v_article.content_html,
            'meta_title', v_article.meta_title,
            'meta_description', v_article.meta_description,
            'canonical_url', v_article.canonical_url,
            'og_image_url', v_article.og_image_url,
            'schema_json', v_article.schema_json,
            'primary_topic', v_article.primary_topic,
            'tags', v_article.tags,
            'language', v_article.language,
            'published_at', v_article.published_at,
            'updated_at', v_article.updated_at
        ),
        'series', v_series,
        'prev_in_series', v_prev_in_series,
        'next_in_series', v_next_in_series,
        'related', COALESCE(v_related, '[]'::jsonb),
        'translations', COALESCE(v_translations, '[]'::jsonb)
    );

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_article_by_slug TO anon, authenticated;

-- C16: save_content_context
CREATE OR REPLACE FUNCTION save_content_context(
    p_app_id UUID,
    p_context JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_app customer_apps%ROWTYPE;
    v_settings JSONB;
BEGIN
    -- Get current app
    SELECT * INTO v_app
    FROM customer_apps
    WHERE id = p_app_id
      AND deleted_at IS NULL;

    IF v_app.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'App not found'
        );
    END IF;

    -- Verify user has access
    IF NOT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_app.organization_id
        AND om.user_id = auth.uid()
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Access denied'
        );
    END IF;

    -- Merge content context into settings
    v_settings := COALESCE(v_app.settings, '{}'::jsonb);
    v_settings := jsonb_set(
        v_settings,
        '{newsletter,content_context}',
        p_context
    );
    v_settings := jsonb_set(
        v_settings,
        '{newsletter,content_context_completed}',
        'true'::jsonb
    );
    v_settings := jsonb_set(
        v_settings,
        '{newsletter,content_context_completed_at}',
        to_jsonb(NOW()::text)
    );

    -- Update app
    UPDATE customer_apps
    SET settings = v_settings,
        updated_at = NOW()
    WHERE id = p_app_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Content context saved'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION save_content_context TO authenticated;

-- C17: add_competitor_for_research
CREATE OR REPLACE FUNCTION add_competitor_for_research(
    p_app_id UUID,
    p_competitor_url TEXT,
    p_competitor_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_app customer_apps%ROWTYPE;
    v_research competitor_research%ROWTYPE;
BEGIN
    -- Validate URL
    IF p_competitor_url IS NULL OR LENGTH(p_competitor_url) < 10 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Invalid URL'
        );
    END IF;

    -- Get app and verify access
    SELECT * INTO v_app
    FROM customer_apps
    WHERE id = p_app_id
      AND deleted_at IS NULL;

    IF v_app.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'App not found'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_app.organization_id
        AND om.user_id = auth.uid()
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Access denied'
        );
    END IF;

    -- Check if already exists
    SELECT * INTO v_research
    FROM competitor_research
    WHERE app_id = p_app_id
      AND competitor_url = p_competitor_url;

    IF v_research.id IS NOT NULL THEN
        -- Already exists, just return it
        RETURN jsonb_build_object(
            'success', true,
            'research_id', v_research.id,
            'status', v_research.status,
            'message', 'Competitor already being tracked'
        );
    END IF;

    -- Create new research entry
    INSERT INTO competitor_research (
        app_id,
        organization_id,
        competitor_url,
        competitor_name,
        status
    ) VALUES (
        p_app_id,
        v_app.organization_id,
        p_competitor_url,
        p_competitor_name,
        'pending'
    )
    RETURNING * INTO v_research;

    RETURN jsonb_build_object(
        'success', true,
        'research_id', v_research.id,
        'status', 'pending',
        'message', 'Competitor added for analysis'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION add_competitor_for_research TO authenticated;

-- C18: get_content_generation_stats
CREATE OR REPLACE FUNCTION get_content_generation_stats(
    p_app_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_stats JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total_articles', COUNT(*),
        'avg_quality_score', ROUND(AVG(final_score)::numeric, 1),
        'articles_needing_rewrites', SUM(CASE WHEN rewrites_needed > 0 THEN 1 ELSE 0 END),
        'avg_rewrites', ROUND(AVG(rewrites_needed)::numeric, 1),
        'total_views', SUM(views),
        'avg_time_on_page', ROUND(AVG(avg_time_on_page_seconds)::numeric, 0),
        'total_conversions', SUM(subscriber_conversions),
        'human_edited_percent', ROUND(
            (SUM(CASE WHEN user_edits_made THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)) * 100,
            1
        )
    ) INTO v_stats
    FROM content_generation_log
    WHERE app_id = p_app_id;

    RETURN v_stats;
END;
$$;

GRANT EXECUTE ON FUNCTION get_content_generation_stats TO authenticated;

-- C19: get_unread_notification_count
CREATE OR REPLACE FUNCTION get_unread_notification_count(p_organization_id UUID)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM owner_notifications
        WHERE organization_id = p_organization_id
        AND is_read = false
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER;

GRANT EXECUTE ON FUNCTION get_unread_notification_count TO authenticated;

-- C20: mark_notification_read
CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE owner_notifications
    SET is_read = true,
        read_at = NOW(),
        read_by = auth.uid()
    WHERE id = p_notification_id
    AND EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = owner_notifications.organization_id
        AND om.user_id = auth.uid()
    );

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

GRANT EXECUTE ON FUNCTION mark_notification_read TO authenticated;

-- C21: mark_all_notifications_read
CREATE OR REPLACE FUNCTION mark_all_notifications_read(p_organization_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE owner_notifications
    SET is_read = true,
        read_at = NOW(),
        read_by = auth.uid()
    WHERE organization_id = p_organization_id
    AND is_read = false
    AND EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = p_organization_id
        AND om.user_id = auth.uid()
    );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

GRANT EXECUTE ON FUNCTION mark_all_notifications_read TO authenticated;

-- C22: get_recent_notifications
CREATE OR REPLACE FUNCTION get_recent_notifications(
    p_organization_id UUID,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    id UUID,
    notification_type TEXT,
    title TEXT,
    message TEXT,
    priority TEXT,
    is_read BOOLEAN,
    ticket_id UUID,
    app_id UUID,
    member_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        n.id,
        n.notification_type,
        n.title,
        n.message,
        n.priority,
        n.is_read,
        n.ticket_id,
        n.app_id,
        n.member_id,
        n.metadata,
        n.created_at
    FROM owner_notifications n
    WHERE n.organization_id = p_organization_id
    AND EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = p_organization_id
        AND om.user_id = auth.uid()
    )
    ORDER BY n.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER;

GRANT EXECUTE ON FUNCTION get_recent_notifications TO authenticated;

-- C23: get_organization_billing
CREATE OR REPLACE FUNCTION get_organization_billing(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_org organizations%ROWTYPE;
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();

    -- Verify user has access to this organization
    IF NOT EXISTS (
        SELECT 1 FROM organization_members
        WHERE organization_id = p_organization_id
        AND user_id = v_user_id
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Access denied'
        );
    END IF;

    -- Get organization
    SELECT * INTO v_org
    FROM organizations
    WHERE id = p_organization_id;

    IF v_org.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Organization not found'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'plan_type', COALESCE(v_org.plan_type, 'free'),
        'subscription_tier', v_org.subscription_tier,
        'subscription_status', v_org.subscription_status,
        'appsumo_tier', v_org.appsumo_tier,
        'has_stripe_customer', v_org.stripe_customer_id IS NOT NULL,
        'has_active_subscription', v_org.subscription_status = 'active' OR v_org.subscription_status = 'trialing'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_organization_billing TO authenticated;

-- C24: get_unique_customer_tags
CREATE OR REPLACE FUNCTION get_unique_customer_tags(p_organization_id UUID)
RETURNS TEXT[] AS $$
DECLARE
    result TEXT[];
BEGIN
    SELECT ARRAY(
        SELECT DISTINCT unnest(tags)
        FROM customers
        WHERE organization_id = p_organization_id
          AND deleted_at IS NULL
          AND tags IS NOT NULL
          AND array_length(tags, 1) > 0
        ORDER BY 1
    ) INTO result;

    RETURN COALESCE(result, ARRAY[]::TEXT[]);
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

GRANT EXECUTE ON FUNCTION get_unique_customer_tags(UUID) TO authenticated;

-- C25: get_org_usage_counts
CREATE OR REPLACE FUNCTION get_org_usage_counts(p_organization_id UUID)
RETURNS TABLE (
    projects_count BIGINT,
    automations_count BIGINT,
    customers_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH project_data AS (
        SELECT id
        FROM projects
        WHERE organization_id = p_organization_id
          AND deleted_at IS NULL
    ),
    automation_data AS (
        SELECT 1
        FROM automations a
        JOIN project_data p ON a.project_id = p.id
        WHERE a.deleted_at IS NULL
    )
    SELECT
        (SELECT COUNT(*) FROM project_data)::BIGINT AS projects_count,
        (SELECT COUNT(*) FROM automation_data)::BIGINT AS automations_count,
        (SELECT COUNT(*) FROM customers WHERE organization_id = p_organization_id AND deleted_at IS NULL)::BIGINT AS customers_count;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

GRANT EXECUTE ON FUNCTION get_org_usage_counts(UUID) TO authenticated;

-- C26: batch_update_customers
CREATE OR REPLACE FUNCTION batch_update_customers(
    p_updates JSONB
)
RETURNS INTEGER AS $$
DECLARE
    update_record JSONB;
    updated_count INTEGER := 0;
BEGIN
    FOR update_record IN SELECT * FROM jsonb_array_elements(p_updates)
    LOOP
        UPDATE customers
        SET
            first_name = COALESCE(update_record->>'first_name', first_name),
            last_name = COALESCE(update_record->>'last_name', last_name),
            email = COALESCE(update_record->>'email', email),
            phone = COALESCE(update_record->>'phone', phone),
            company = COALESCE(update_record->>'company', company),
            tags = CASE
                WHEN update_record->'tags' IS NOT NULL
                THEN ARRAY(SELECT jsonb_array_elements_text(update_record->'tags'))
                ELSE tags
            END,
            custom_data = CASE
                WHEN update_record->'custom_data' IS NOT NULL
                THEN (update_record->'custom_data')
                ELSE custom_data
            END,
            updated_at = NOW()
        WHERE id = (update_record->>'id')::UUID;

        updated_count := updated_count + 1;
    END LOOP;

    RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

GRANT EXECUTE ON FUNCTION batch_update_customers(JSONB) TO authenticated;

-- C27: get_customer_stats
CREATE OR REPLACE FUNCTION get_customer_stats(p_organization_id UUID)
RETURNS TABLE (
    total_count BIGINT,
    new_this_month BIGINT,
    with_email BIGINT,
    with_phone BIGINT
) AS $$
DECLARE
    start_of_month TIMESTAMPTZ;
BEGIN
    start_of_month := date_trunc('month', NOW());

    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT AS total_count,
        COUNT(*) FILTER (WHERE created_at >= start_of_month)::BIGINT AS new_this_month,
        COUNT(*) FILTER (WHERE email IS NOT NULL AND email != '')::BIGINT AS with_email,
        COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone != '')::BIGINT AS with_phone
    FROM customers
    WHERE organization_id = p_organization_id
      AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

GRANT EXECUTE ON FUNCTION get_customer_stats(UUID) TO authenticated;


-- =====================================================
-- DONE! All views and functions migrated.
-- Safe to re-run (uses CREATE OR REPLACE).
-- =====================================================
