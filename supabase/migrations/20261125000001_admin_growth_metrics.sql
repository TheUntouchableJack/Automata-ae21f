-- =============================================================================
-- Growth metrics for Super Admin (plan can-we-enhance-our-breezy-flute, 2026-11-25)
-- =============================================================================
-- 1. organizations.is_internal: Royalty's own and test orgs, left out of growth numbers.
--    Backfilled ONCE (when the column is first added): orgs owned by an is_admin profile, or by a
--    plus-address of one (name+anything@domain → name@domain). No email or domain is written in
--    this file: the deploy repo is public. Only Super Admin (or the service role) can change it.
-- 2. admin_set_org_internal(uuid, boolean)                  mark / unmark from the Orgs tab.
-- 3. admin_growth_metrics(int, boolean) → jsonb             the Growth tab's database half.
-- 4. admin_get_all_organizations(): DROP + recreate. Adds is_internal; "last activity" now includes
--    organizations.last_active_at (the dashboard ping), not only audit logs. The return type
--    changes, so CREATE OR REPLACE cannot do it. Only app/admin.js reads it.
-- 5. update_org_activity(uuid): only a real member of the org moves last_active_at. Before, any
--    caller (anon included) could bump any org, and Super Admin "view as" counted as the owner
--    coming back, which would inflate the "came back" milestone.
--
-- Metric definitions (also shown in the Growth tab):
--   sign-up          an organization created (staff and app members get no org: handle_new_user)
--   confirmed        the owner's auth.users.email_confirmed_at is set
--   came back        last_active_at more than 24h after created_at
--   has rewards      at least one live app_rewards row (is_published is NOT used: every new app
--                    is auto-published by the dashboard)
--   first customer   at least one real member: not deleted, not on the org's own team
--   activated        at least 5 real members AND at least one check-in by one of them
--   paid             plan_type 'subscription' with status active/trialing; date = plan_changed_at
--   churned          cancelled_at
--   est. MRR         each paid org's tier at its monthly list price (annual vs monthly not stored)
-- Days are UTC. A period of N days = today so far + the N-1 days before; "previous" = the N before.

-- ===== 0. Pre-flight: every column this file reads must exist =====
DO $$
DECLARE
    v_missing TEXT;
BEGIN
    SELECT string_agg(need.s || '.' || need.t || '.' || need.c, ', ') INTO v_missing
    FROM (VALUES
        ('public', 'organizations', 'created_at'),
        ('public', 'organizations', 'plan_type'),
        ('public', 'organizations', 'subscription_tier'),
        ('public', 'organizations', 'subscription_status'),
        ('public', 'organizations', 'plan_changed_at'),
        ('public', 'organizations', 'cancelled_at'),
        ('public', 'organizations', 'last_active_at'),
        ('public', 'organization_members', 'is_impersonating'),
        ('public', 'organization_members', 'joined_at'),
        ('public', 'profiles', 'is_admin'),
        ('public', 'customer_apps', 'deleted_at'),
        ('public', 'app_members', 'user_id'),
        ('public', 'app_members', 'joined_at'),
        ('public', 'app_members', 'deleted_at'),
        ('public', 'member_visits', 'member_id'),
        ('public', 'member_visits', 'visited_at'),
        ('public', 'app_rewards', 'is_active'),
        ('public', 'app_rewards', 'deleted_at'),
        ('public', 'reward_redemptions', 'member_id'),
        ('public', 'reward_redemptions', 'redeemed_at'),
        ('public', 'reward_redemptions', 'status'),
        ('public', 'audit_logs', 'created_at'),
        ('auth', 'users', 'email_confirmed_at'),
        ('auth', 'users', 'last_sign_in_at'),
        ('auth', 'users', 'raw_user_meta_data')
    ) AS need(s, t, c)
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns ic
        WHERE ic.table_schema = need.s AND ic.table_name = need.t AND ic.column_name = need.c
    );
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'pre-flight: missing columns: %', v_missing;
    END IF;
END $$;


-- ===== 1. organizations.is_internal (+ one-time backfill) =====
DO $$
DECLARE
    v_marked TEXT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'is_internal'
    ) THEN
        RAISE NOTICE 'is_internal already exists: backfill skipped (keeps choices made in Super Admin).';
        RETURN;
    END IF;

    ALTER TABLE public.organizations ADD COLUMN is_internal BOOLEAN NOT NULL DEFAULT false;

    WITH admin_emails AS (
        SELECT DISTINCT lower(p.email) AS email
        FROM public.profiles p
        WHERE p.is_admin = true AND p.email IS NOT NULL
    ),
    marked AS (
        UPDATE public.organizations o
        SET is_internal = true
        WHERE EXISTS (
            SELECT 1
            FROM public.organization_members om
            JOIN public.profiles p ON p.id = om.user_id
            WHERE om.organization_id = o.id
              AND om.role = 'owner'
              AND NOT COALESCE(om.is_impersonating, false)
              AND regexp_replace(lower(p.email), '\+[^@]*@', '@') IN (SELECT email FROM admin_emails)
        )
        RETURNING o.name
    )
    SELECT string_agg(COALESCE(name, '(unnamed)'), ', ' ORDER BY name) INTO v_marked FROM marked;

    RAISE NOTICE 'is_internal backfill marked: %', COALESCE(v_marked, '(none)');
END $$;

COMMENT ON COLUMN public.organizations.is_internal IS
    'Royalty''s own or a test org: left out of the Super Admin growth numbers. Changed only from Super Admin.';

-- Owners can update their own organizations row from the browser (RLS policy "Org owners can
-- update their organization"), so the flag needs its own guard: browser roles can't set it.
CREATE OR REPLACE FUNCTION public.organizations_guard_is_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF current_user IN ('anon', 'authenticated') THEN
        IF TG_OP = 'INSERT' THEN
            NEW.is_internal := false;
        ELSIF NEW.is_internal IS DISTINCT FROM OLD.is_internal THEN
            RAISE EXCEPTION 'is_internal can only be changed from Super Admin' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_guard_is_internal ON public.organizations;
CREATE TRIGGER organizations_guard_is_internal
    BEFORE INSERT OR UPDATE OF is_internal ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.organizations_guard_is_internal();

REVOKE ALL ON FUNCTION public.organizations_guard_is_internal() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.organizations_guard_is_internal() FROM anon;
REVOKE ALL ON FUNCTION public.organizations_guard_is_internal() FROM authenticated;


-- ===== 2. admin_set_org_internal(p_org_id, p_internal) =====
CREATE OR REPLACE FUNCTION public.admin_set_org_internal(p_org_id UUID, p_internal BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Verify caller is super admin
    IF NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: super admin required';
    END IF;

    IF p_internal IS NULL THEN
        RAISE EXCEPTION 'p_internal is required';
    END IF;

    UPDATE organizations SET is_internal = p_internal WHERE organizations.id = p_org_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Organization not found';
    END IF;

    RETURN p_internal;
END;
$$;


-- ===== 3. admin_growth_metrics(p_days, p_include_internal) =====
-- p_days: 7 / 30 / 90 / 365 from the UI; NULL or <= 0 = all time; anything else is clamped to 3650.
CREATE OR REPLACE FUNCTION public.admin_growth_metrics(p_days INT DEFAULT 30, p_include_internal BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inc      BOOLEAN := COALESCE(p_include_internal, false);
    v_today    DATE := (now() AT TIME ZONE 'utc')::date;
    v_days     INT;
    v_from     DATE;
    v_from_ts  TIMESTAMPTZ;
    v_prev_ts  TIMESTAMPTZ;
    v_result   JSONB;
BEGIN
    -- Verify caller is super admin
    IF NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: super admin required';
    END IF;

    v_days := CASE WHEN p_days IS NULL OR p_days <= 0 THEN NULL ELSE LEAST(p_days, 3650) END;
    IF v_days IS NULL THEN
        SELECT COALESCE(MIN((o.created_at AT TIME ZONE 'utc')::date), v_today) INTO v_from
        FROM organizations o
        WHERE v_inc OR NOT o.is_internal;
        v_from := LEAST(v_from, v_today);
    ELSE
        v_from := v_today - (v_days - 1);
    END IF;
    v_from_ts := v_from::timestamp AT TIME ZONE 'utc';
    v_prev_ts := CASE WHEN v_days IS NULL THEN NULL ELSE (v_from - v_days)::timestamp AT TIME ZONE 'utc' END;

    WITH
    o AS (
        SELECT org.*
        FROM organizations org
        WHERE v_inc OR NOT org.is_internal
    ),
    own AS (
        -- One owner per org: the earliest real (non-impersonating) owner.
        SELECT DISTINCT ON (om.organization_id) om.organization_id AS org_id, om.user_id
        FROM organization_members om
        WHERE om.role = 'owner' AND NOT COALESCE(om.is_impersonating, false)
        ORDER BY om.organization_id, om.joined_at NULLS LAST, om.user_id
    ),
    team AS (
        -- Everyone on an org's own team (impersonating admins included): their own test joins
        -- of the org's app are not customers.
        SELECT om.organization_id AS org_id, om.user_id, lower(p.email) AS email
        FROM organization_members om
        LEFT JOIN profiles p ON p.id = om.user_id
    ),
    apps AS (
        SELECT ca.id AS app_id, ca.organization_id AS org_id
        FROM customer_apps ca
        JOIN o ON o.id = ca.organization_id
        WHERE ca.deleted_at IS NULL
    ),
    mem AS (
        SELECT m.id, a.org_id, m.joined_at
        FROM app_members m
        JOIN apps a ON a.app_id = m.app_id
        WHERE m.deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM team t
              WHERE t.org_id = a.org_id
                AND ((m.user_id IS NOT NULL AND t.user_id = m.user_id)
                     OR (m.email IS NOT NULL AND t.email = lower(m.email)))
          )
    ),
    vis AS (
        SELECT v.id, mem.org_id, v.visited_at
        FROM member_visits v
        JOIN mem ON mem.id = v.member_id
    ),
    red AS (
        SELECT r.id, mem.org_id, r.redeemed_at
        FROM reward_redemptions r
        JOIN mem ON mem.id = r.member_id
        WHERE COALESCE(r.status, '') <> 'cancelled'
    ),
    rw AS (
        SELECT DISTINCT a.org_id
        FROM app_rewards x
        JOIN apps a ON a.app_id = x.app_id
        WHERE x.is_active IS NOT FALSE AND x.deleted_at IS NULL
    ),
    m5 AS (
        SELECT y.org_id, y.joined_at AS fifth_at
        FROM (
            SELECT mem.org_id, mem.joined_at,
                   row_number() OVER (PARTITION BY mem.org_id ORDER BY mem.joined_at, mem.id) AS rn
            FROM mem
        ) y
        WHERE y.rn = 5
    ),
    mc AS (SELECT mem.org_id, COUNT(*) AS n, MIN(mem.joined_at) AS first_at FROM mem GROUP BY mem.org_id),
    vc AS (SELECT vis.org_id, COUNT(*) AS n, MIN(vis.visited_at) AS first_at, MAX(vis.visited_at) AS last_at
           FROM vis GROUP BY vis.org_id),
    facts AS (
        SELECT o.id, o.name, o.created_at, o.is_internal, o.last_active_at,
               o.plan_type, o.subscription_tier, o.subscription_status, o.plan_changed_at, o.cancelled_at,
               u.email AS owner_email, u.email_confirmed_at, u.last_sign_in_at,
               CASE WHEN jsonb_typeof(u.raw_user_meta_data -> 'signup_source') = 'object'
                    THEN u.raw_user_meta_data -> 'signup_source' END AS source,
               COALESCE(mc.n, 0) AS members,
               mc.first_at AS first_member_at,
               COALESCE(vc.n, 0) AS checkins,
               vc.first_at AS first_visit_at,
               vc.last_at AS last_visit_at,
               m5.fifth_at,
               (rw.org_id IS NOT NULL) AS has_rewards
        FROM o
        LEFT JOIN own ON own.org_id = o.id
        LEFT JOIN auth.users u ON u.id = own.user_id
        LEFT JOIN mc ON mc.org_id = o.id
        LEFT JOIN vc ON vc.org_id = o.id
        LEFT JOIN m5 ON m5.org_id = o.id
        LEFT JOIN rw ON rw.org_id = o.id
    ),
    ms AS (
        SELECT f.*,
               (f.email_confirmed_at IS NOT NULL) AS confirmed,
               COALESCE(f.last_active_at > f.created_at + interval '24 hours', false) AS came_back,
               (f.members >= 1) AS first_customer,
               (f.members >= 5 AND f.checkins >= 1) AS activated,
               CASE WHEN f.members >= 5 AND f.checkins >= 1
                    THEN GREATEST(f.fifth_at, f.first_visit_at) END AS activated_at,
               (f.plan_type = 'subscription' AND f.subscription_status IN ('active', 'trialing')) AS paid,
               CASE f.subscription_tier
                    WHEN 'starter' THEN 19.99
                    WHEN 'growth'  THEN 39.99
                    WHEN 'scale'   THEN 79.99
                    WHEN 'pro'     THEN 299
                    WHEN 'max'     THEN 749
                    ELSE 0 END AS list_price,
               left(lower(COALESCE(
                    NULLIF(btrim(f.source ->> 'utm_source'), ''),
                    NULLIF(btrim(f.source ->> 'referrer'), ''),
                    CASE WHEN f.source IS NULL THEN 'unknown' ELSE 'direct' END)), 60) AS source_label
        FROM facts f
    ),
    periods AS (
        SELECT 'cur'::TEXT AS k, v_from_ts AS a, now() AS b
        UNION ALL
        SELECT 'prev'::TEXT, v_prev_ts, v_from_ts WHERE v_prev_ts IS NOT NULL
    ),
    per AS (
        SELECT p.k,
               (SELECT COUNT(*) FROM ms WHERE ms.created_at >= p.a AND ms.created_at < p.b) AS signups,
               (SELECT COUNT(*) FROM ms WHERE ms.first_member_at >= p.a AND ms.first_member_at < p.b) AS first_customer,
               (SELECT COUNT(*) FROM ms WHERE ms.activated_at >= p.a AND ms.activated_at < p.b) AS activated,
               (SELECT COUNT(*) FROM ms WHERE ms.paid AND ms.plan_changed_at >= p.a AND ms.plan_changed_at < p.b) AS paid,
               (SELECT COUNT(*) FROM ms WHERE ms.cancelled_at >= p.a AND ms.cancelled_at < p.b) AS churned,
               (SELECT COUNT(*) FROM mem WHERE mem.joined_at >= p.a AND mem.joined_at < p.b) AS new_members,
               (SELECT COUNT(*) FROM vis WHERE vis.visited_at >= p.a AND vis.visited_at < p.b) AS checkins,
               (SELECT COUNT(*) FROM red WHERE red.redeemed_at >= p.a AND red.redeemed_at < p.b) AS redemptions
        FROM periods p
    ),
    days AS (
        SELECT gs::date AS d FROM generate_series(v_from::timestamp, v_today::timestamp, interval '1 day') gs
    ),
    daily AS (
        SELECT days.d,
               COALESCE(s.n, 0) AS signups,
               COALESCE(nm.n, 0) AS new_members,
               COALESCE(ci.n, 0) AS checkins,
               COALESCE(rd.n, 0) AS redemptions,
               COALESCE(pd.n, 0) AS paid
        FROM days
        LEFT JOIN (SELECT (ms.created_at AT TIME ZONE 'utc')::date AS d, COUNT(*) AS n FROM ms GROUP BY 1) s ON s.d = days.d
        LEFT JOIN (SELECT (mem.joined_at AT TIME ZONE 'utc')::date AS d, COUNT(*) AS n FROM mem GROUP BY 1) nm ON nm.d = days.d
        LEFT JOIN (SELECT (vis.visited_at AT TIME ZONE 'utc')::date AS d, COUNT(*) AS n FROM vis GROUP BY 1) ci ON ci.d = days.d
        LEFT JOIN (SELECT (red.redeemed_at AT TIME ZONE 'utc')::date AS d, COUNT(*) AS n FROM red GROUP BY 1) rd ON rd.d = days.d
        LEFT JOIN (SELECT (ms.plan_changed_at AT TIME ZONE 'utc')::date AS d, COUNT(*) AS n
                   FROM ms WHERE ms.paid GROUP BY 1) pd ON pd.d = days.d
    ),
    weeks AS (
        SELECT gs::date AS w
        FROM generate_series(date_trunc('week', v_today::timestamp) - interval '11 weeks',
                             date_trunc('week', v_today::timestamp), interval '1 week') gs
    ),
    cohort AS (
        SELECT * FROM ms WHERE ms.created_at >= v_from_ts
    )
    SELECT jsonb_build_object(
        'window', jsonb_build_object(
            'days', v_days,
            'from', v_from,
            'to', v_today,
            'include_internal', v_inc,
            'generated_at', now()
        ),
        'kpis', jsonb_build_object(
            'cur',  (SELECT to_jsonb(per) - 'k' FROM per WHERE per.k = 'cur'),
            'prev', (SELECT to_jsonb(per) - 'k' FROM per WHERE per.k = 'prev'),
            'active_7d', (SELECT COUNT(*) FROM ms
                          WHERE ms.last_active_at >= now() - interval '7 days'
                             OR ms.last_visit_at >= now() - interval '7 days'),
            'paid_total', (SELECT COUNT(*) FROM ms WHERE ms.paid),
            'paid_by_tier', COALESCE((SELECT jsonb_object_agg(t.tier, t.n) FROM (
                                SELECT COALESCE(ms.subscription_tier, 'unknown') AS tier, COUNT(*) AS n
                                FROM ms WHERE ms.paid GROUP BY 1) t), '{}'::jsonb),
            'est_mrr', (SELECT COALESCE(round(SUM(ms.list_price), 2), 0) FROM ms WHERE ms.paid),
            'orgs_total', (SELECT COUNT(*) FROM ms),
            'internal_orgs', (SELECT COUNT(*) FROM organizations x WHERE x.is_internal)
        ),
        'daily', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'date', daily.d, 'signups', daily.signups, 'new_members', daily.new_members,
                    'checkins', daily.checkins, 'redemptions', daily.redemptions, 'paid', daily.paid
                 ) ORDER BY daily.d) FROM daily), '[]'::jsonb),
        'funnel', (SELECT jsonb_build_object(
                    'account',        COUNT(*),
                    'confirmed',      COUNT(*) FILTER (WHERE cohort.confirmed),
                    'came_back',      COUNT(*) FILTER (WHERE cohort.came_back),
                    'has_rewards',    COUNT(*) FILTER (WHERE cohort.has_rewards),
                    'first_customer', COUNT(*) FILTER (WHERE cohort.first_customer),
                    'activated',      COUNT(*) FILTER (WHERE cohort.activated),
                    'paid',           COUNT(*) FILTER (WHERE cohort.paid)
                 ) FROM cohort),
        'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'source', s.source_label, 'signups', s.signups, 'first_customer', s.first_customer,
                    'activated', s.activated, 'paid', s.paid
                 ) ORDER BY s.signups DESC, s.source_label) FROM (
                    SELECT cohort.source_label,
                           COUNT(*) AS signups,
                           COUNT(*) FILTER (WHERE cohort.first_customer) AS first_customer,
                           COUNT(*) FILTER (WHERE cohort.activated) AS activated,
                           COUNT(*) FILTER (WHERE cohort.paid) AS paid
                    FROM cohort GROUP BY cohort.source_label) s), '[]'::jsonb),
        'cohorts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'week', weeks.w,
                    'signups',        (SELECT COUNT(*) FROM ms WHERE date_trunc('week', ms.created_at AT TIME ZONE 'utc')::date = weeks.w),
                    'confirmed',      (SELECT COUNT(*) FROM ms WHERE ms.confirmed AND date_trunc('week', ms.created_at AT TIME ZONE 'utc')::date = weeks.w),
                    'came_back',      (SELECT COUNT(*) FROM ms WHERE ms.came_back AND date_trunc('week', ms.created_at AT TIME ZONE 'utc')::date = weeks.w),
                    'has_rewards',    (SELECT COUNT(*) FROM ms WHERE ms.has_rewards AND date_trunc('week', ms.created_at AT TIME ZONE 'utc')::date = weeks.w),
                    'first_customer', (SELECT COUNT(*) FROM ms WHERE ms.first_customer AND date_trunc('week', ms.created_at AT TIME ZONE 'utc')::date = weeks.w),
                    'activated',      (SELECT COUNT(*) FROM ms WHERE ms.activated AND date_trunc('week', ms.created_at AT TIME ZONE 'utc')::date = weeks.w),
                    'paid',           (SELECT COUNT(*) FROM ms WHERE ms.paid AND date_trunc('week', ms.created_at AT TIME ZONE 'utc')::date = weeks.w)
                 ) ORDER BY weeks.w DESC) FROM weeks), '[]'::jsonb),
        'recent_signups', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'id', r.id,
                    'name', r.name,
                    'is_internal', r.is_internal,
                    'owner_email', r.owner_email,
                    'created_at', r.created_at,
                    'source', r.source,
                    'source_label', r.source_label,
                    'confirmed', r.confirmed,
                    'came_back', r.came_back,
                    'has_rewards', r.has_rewards,
                    'first_customer', r.first_customer,
                    'activated', r.activated,
                    'paid', r.paid,
                    'tier', r.subscription_tier,
                    'stuck_at', CASE
                        WHEN NOT r.confirmed      THEN 'confirmed'
                        WHEN NOT r.came_back      THEN 'came_back'
                        WHEN NOT r.has_rewards    THEN 'has_rewards'
                        WHEN NOT r.first_customer THEN 'first_customer'
                        WHEN NOT r.activated      THEN 'activated'
                        WHEN NOT r.paid           THEN 'paid'
                        END,
                    'members', r.members,
                    'checkins', r.checkins,
                    'last_seen', GREATEST(r.last_active_at, r.last_sign_in_at)
                 ) ORDER BY r.created_at DESC) FROM (
                    SELECT * FROM ms ORDER BY ms.created_at DESC LIMIT 25) r), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$$;


-- ===== 4. admin_get_all_organizations(): + is_internal, last activity includes last_active_at =====
DROP FUNCTION IF EXISTS public.admin_get_all_organizations();

CREATE FUNCTION public.admin_get_all_organizations()
RETURNS TABLE (
    id UUID,
    name TEXT,
    slug TEXT,
    plan_type TEXT,
    subscription_tier TEXT,
    appsumo_tier INT,
    has_royalty_pro BOOLEAN,
    subscription_status TEXT,
    plan_limits_override JSONB,
    created_at TIMESTAMPTZ,
    owner_email TEXT,
    owner_name TEXT,
    member_count BIGINT,
    customer_count BIGINT,
    last_activity TIMESTAMPTZ,
    is_internal BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Verify caller is super admin
    IF NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: super admin required';
    END IF;

    RETURN QUERY
    SELECT
        o.id,
        o.name::TEXT,
        o.slug::TEXT,
        o.plan_type::TEXT,
        o.subscription_tier::TEXT,
        o.appsumo_tier::INT,
        o.has_royalty_pro::BOOLEAN,
        o.subscription_status::TEXT,
        o.plan_limits_override,
        o.created_at,
        p.email::TEXT AS owner_email,
        CONCAT(p.first_name, ' ', p.last_name)::TEXT AS owner_name,
        (SELECT COUNT(*) FROM organization_members om2
         WHERE om2.organization_id = o.id AND om2.is_impersonating = false) AS member_count,
        (SELECT COUNT(*) FROM customers c
         WHERE c.organization_id = o.id AND c.deleted_at IS NULL) AS customer_count,
        GREATEST(
            o.created_at,
            o.last_active_at,
            (SELECT MAX(al.created_at) FROM audit_logs al WHERE al.organization_id = o.id)
        ) AS last_activity,
        o.is_internal
    FROM organizations o
    LEFT JOIN organization_members om ON om.organization_id = o.id
        AND om.role = 'owner' AND om.is_impersonating = false
    LEFT JOIN profiles p ON p.id = om.user_id
    ORDER BY o.created_at DESC;
END;
$$;


-- ===== 5. update_org_activity(): a real member of the org, or nothing =====
CREATE OR REPLACE FUNCTION public.update_org_activity(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE organizations
    SET last_active_at = NOW()
    WHERE organizations.id = p_org_id
      AND EXISTS (
          SELECT 1 FROM organization_members om
          WHERE om.organization_id = p_org_id
            AND om.user_id = auth.uid()
            AND NOT COALESCE(om.is_impersonating, false)
      );
END;
$$;


-- ===== 6. Grants =====
-- ⚠️ REVOKE ... FROM PUBLIC does NOT restrict anon in this project (Supabase
-- grants anon directly), hence the explicit FROM anon on every function.

REVOKE ALL ON FUNCTION public.admin_set_org_internal(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_org_internal(UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_org_internal(UUID, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_growth_metrics(INT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_growth_metrics(INT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_growth_metrics(INT, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_get_all_organizations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_all_organizations() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_all_organizations() TO authenticated;

REVOKE ALL ON FUNCTION public.update_org_activity(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_org_activity(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_org_activity(UUID) TO authenticated;
