-- =============================================================================
-- Billing guard, admin plan editing, "view as" on your own org (2026-11-25, after the Growth tab round)
-- =============================================================================
-- 1. organizations: browser roles can no longer change billing / entitlement columns.
--    Found live 2026-11-25: the RLS policy "Org owners can update their organization" has no column
--    list, so an owner could set their own plan_type / subscription_tier (a free Scale plan) from the
--    browser. The only browser writes to organizations are Settings' AI autonomy fields and Royal AI's
--    business-profile answers; everything billing is written by stripe-webhook / edge functions
--    (service_role) or SECURITY DEFINER functions, which this guard lets through.
--    The guard compares OLD and NEW as JSON, so it names no column that might be missing live.
-- 2. add_messaging_credits / increment_email_usage / increment_sms_usage: service_role only.
--    Found live 2026-11-25: anon could run them (SECURITY DEFINER, no caller check), i.e. give any org
--    unlimited email/SMS credits or inflate another org's usage. Callers: stripe-webhook and
--    message-sender, both service_role.
-- 3. admin_update_organization_plan: validates plan and tier, drops the tier when the plan isn't a
--    subscription (a stale tier lingered), and '{}' now CLEARS the overrides (NULL still keeps them),
--    so "Clear Overrides" in Super Admin works.
-- 4. admin_start_impersonation: "view as" on an org you already belong to left your row as
--    role 'admin' + is_impersonating, and admin_stop_impersonation then DELETED it: an owner lost
--    their own org. Now an existing membership is left alone (ON CONFLICT DO NOTHING).

-- ===== 1. Billing guard on organizations =====
CREATE OR REPLACE FUNCTION public.organizations_guard_billing()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    c_cols CONSTANT TEXT[] := ARRAY[
        'plan_type', 'subscription_tier', 'subscription_status',
        'stripe_customer_id', 'stripe_subscription_id', 'subscription_cancel_at',
        'plan_changed_at', 'cancelled_at', 'cancellation_reason',
        'is_lifetime', 'appsumo_tier', 'appsumo_codes',
        'has_royalty_pro', 'royalty_pro_status', 'royalty_pro_subscription_id',
        'plan_limits_override', 'payment_failure_count', 'last_payment_failure_at',
        'churn_risk_score', 'churn_risk_updated_at'
    ];
    v_new JSONB;
    v_old JSONB;
    v_bad TEXT;
BEGIN
    IF current_user NOT IN ('anon', 'authenticated') THEN
        RETURN NEW;
    END IF;

    v_new := to_jsonb(NEW);

    IF TG_OP = 'INSERT' THEN
        -- An org made from the browser starts on the free plan's values (column defaults pass).
        SELECT string_agg(c, ', ') INTO v_bad
        FROM unnest(c_cols) AS c
        WHERE COALESCE(v_new -> c, 'null'::jsonb) NOT IN
              ('null'::jsonb, '"free"'::jsonb, '"inactive"'::jsonb, 'false'::jsonb, '0'::jsonb);
    ELSE
        v_old := to_jsonb(OLD);
        SELECT string_agg(c, ', ') INTO v_bad
        FROM unnest(c_cols) AS c
        WHERE (v_new -> c) IS DISTINCT FROM (v_old -> c);
    END IF;

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Only billing or Super Admin can change: %', v_bad USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_guard_billing ON public.organizations;
CREATE TRIGGER organizations_guard_billing
    BEFORE INSERT OR UPDATE ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.organizations_guard_billing();

REVOKE ALL ON FUNCTION public.organizations_guard_billing() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.organizations_guard_billing() FROM anon;
REVOKE ALL ON FUNCTION public.organizations_guard_billing() FROM authenticated;


-- ===== 2. Credit and usage writers: service_role only (every overload) =====
DO $$
DECLARE
    r RECORD;
    v_done TEXT := '';
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('add_messaging_credits', 'increment_email_usage', 'increment_sms_usage')
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
        v_done := v_done || ' ' || r.sig::text;
    END LOOP;
    RAISE NOTICE 'service_role only now:%', CASE WHEN v_done = '' THEN ' (none found)' ELSE v_done END;
END $$;


-- ===== 3. admin_update_organization_plan =====
CREATE OR REPLACE FUNCTION public.admin_update_organization_plan(
    p_org_id UUID,
    p_plan_type TEXT DEFAULT NULL,
    p_subscription_tier TEXT DEFAULT NULL,
    p_plan_limits_override JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: super admin required';
    END IF;

    IF p_plan_type IS NOT NULL AND p_plan_type NOT IN ('free', 'subscription', 'appsumo_lifetime') THEN
        RAISE EXCEPTION 'Unknown plan type: %', p_plan_type;
    END IF;
    IF p_subscription_tier IS NOT NULL AND p_subscription_tier NOT IN ('starter', 'growth', 'scale', 'pro', 'max') THEN
        RAISE EXCEPTION 'Unknown subscription tier: %', p_subscription_tier;
    END IF;
    IF p_plan_limits_override IS NOT NULL AND jsonb_typeof(p_plan_limits_override) <> 'object' THEN
        RAISE EXCEPTION 'Overrides must be a JSON object';
    END IF;

    UPDATE organizations o SET
        plan_type = COALESCE(p_plan_type, o.plan_type),
        -- Only a subscription has a tier.
        subscription_tier = CASE
            WHEN COALESCE(p_plan_type, o.plan_type) = 'subscription'
                THEN COALESCE(p_subscription_tier, o.subscription_tier)
            ELSE NULL
        END,
        -- NULL keeps the overrides; '{}' clears them.
        plan_limits_override = CASE
            WHEN p_plan_limits_override IS NULL THEN o.plan_limits_override
            WHEN p_plan_limits_override = '{}'::jsonb THEN NULL
            ELSE p_plan_limits_override
        END,
        plan_changed_at = NOW()
    WHERE o.id = p_org_id
    RETURNING jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'plan_type', o.plan_type,
        'subscription_tier', o.subscription_tier,
        'plan_limits_override', o.plan_limits_override,
        'plan_changed_at', o.plan_changed_at
    ) INTO result;

    IF result IS NULL THEN
        RAISE EXCEPTION 'Organization not found';
    END IF;

    RETURN result;
END;
$$;


-- ===== 4. admin_start_impersonation: an existing membership is left alone =====
CREATE OR REPLACE FUNCTION public.admin_start_impersonation(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    admin_id UUID;
    org_record RECORD;
BEGIN
    admin_id := auth.uid();

    IF NOT EXISTS (
        SELECT 1 FROM profiles WHERE profiles.id = admin_id AND profiles.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: super admin required';
    END IF;

    -- Clean up any existing impersonation records for this admin
    DELETE FROM organization_members
    WHERE user_id = admin_id AND is_impersonating = true;

    -- Add admin as temporary member. If they already belong to this org (their own org),
    -- their real row stays as it is: admin_stop_impersonation deletes impersonation rows only.
    INSERT INTO organization_members (organization_id, user_id, role, is_impersonating)
    VALUES (p_org_id, admin_id, 'admin', true)
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    -- Return org details
    SELECT o.id, o.name, o.slug, o.plan_type, o.subscription_tier,
           o.appsumo_tier, o.plan_limits_override
    INTO org_record
    FROM organizations o WHERE o.id = p_org_id;

    RETURN jsonb_build_object(
        'id', org_record.id,
        'name', org_record.name,
        'slug', org_record.slug,
        'plan_type', org_record.plan_type,
        'subscription_tier', org_record.subscription_tier,
        'appsumo_tier', org_record.appsumo_tier,
        'plan_limits_override', org_record.plan_limits_override
    );
END;
$$;


-- ===== 5. Grants =====
-- ⚠️ REVOKE ... FROM PUBLIC does NOT restrict anon in this project (Supabase
-- grants anon directly), hence the explicit FROM anon on every function.

REVOKE ALL ON FUNCTION public.admin_update_organization_plan(UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_organization_plan(UUID, TEXT, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_update_organization_plan(UUID, TEXT, TEXT, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_start_impersonation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_start_impersonation(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_start_impersonation(UUID) TO authenticated;
