-- Royal AI early access: a status switch, a waitlist, and the recovery cron.
--
-- When Anthropic credits run out (or Jay wants to hold AI spend), people still sign up and
-- get a working loyalty app; only the AI features wait, and the owner is told they're on the
-- early-access list. Nothing here gates signup.
--
-- 1. platform_status: one row per platform switch. Row 'ai' =
--      { mode: 'auto'|'on'|'waitlist', available: bool, reason, since, last_probe_at, notify_daily_cap }
--    RLS on, no policies, no grants: only SECURITY DEFINER functions and the service role touch it.
--    Jay's switch, in the SQL editor:
--      UPDATE platform_status SET value = value || '{"mode":"waitlist"}', updated_at = now() WHERE key = 'ai';
--      ('on' forces it on; 'auto' goes back to detection.)
-- 2. ai_waitlist: one row per org. join_ai_waitlist() adds the caller's own org, and only while
--    Royal AI is off. Nothing else can write it from the client.
-- 3. get_ai_status(): anon + authenticated. Returns {enabled} (and on_waitlist for a signed-in owner).
-- 4. report_ai_health() / claim_ai_probe(): service role only (edge functions).
-- 5. Two cron jobs: ai-health every 15 min (probes only while auto mode has the AI off),
--    ai-waitlist-notify hourly (emails waitlisted owners once Royal AI is back, capped per day).
--    Both functions run verify_jwt = false and are safe to call by anyone: each does nothing
--    unless the state says so, and each owner is emailed at most once.

-- ── 1. platform_status ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_status (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_status FROM PUBLIC;
REVOKE ALL ON public.platform_status FROM anon, authenticated;

INSERT INTO public.platform_status (key, value)
VALUES ('ai', jsonb_build_object(
    'mode', 'auto', 'available', true, 'reason', null, 'since', now(),
    'last_probe_at', null, 'notify_daily_cap', 50))
ON CONFLICT (key) DO NOTHING;

-- ── 2. ai_waitlist ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_waitlist (
    org_id      UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    notified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_waitlist_pending ON public.ai_waitlist (joined_at) WHERE notified_at IS NULL;
ALTER TABLE public.ai_waitlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_waitlist FROM PUBLIC;
REVOKE ALL ON public.ai_waitlist FROM anon, authenticated;

-- ── 3. The on/off rule (one place in SQL; _shared/ai-status.ts aiEnabledFrom() mirrors it) ──
CREATE OR REPLACE FUNCTION public.ai_enabled_from(p_value JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT CASE
        WHEN p_value IS NULL THEN true
        WHEN p_value->>'mode' = 'on' THEN true
        WHEN p_value->>'mode' = 'waitlist' THEN false
        ELSE COALESCE((p_value->>'available')::boolean, true)
    END;
$$;
REVOKE EXECUTE ON FUNCTION public.ai_enabled_from(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_enabled_from(JSONB) FROM anon, authenticated;

-- The caller's org: the one they own first, else their earliest membership.
CREATE OR REPLACE FUNCTION public.ai_caller_org()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT om.organization_id
    FROM organization_members om
    WHERE om.user_id = auth.uid()
    ORDER BY (om.role = 'owner') DESC, om.joined_at ASC NULLS LAST
    LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.ai_caller_org() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_caller_org() FROM anon, authenticated;

-- ── 4. get_ai_status ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_ai_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_value JSONB;
    v_org   UUID;
BEGIN
    SELECT value INTO v_value FROM platform_status WHERE key = 'ai';
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('enabled', ai_enabled_from(v_value));
    END IF;
    v_org := ai_caller_org();
    RETURN jsonb_build_object(
        'enabled', ai_enabled_from(v_value),
        'on_waitlist', v_org IS NOT NULL AND EXISTS (SELECT 1 FROM ai_waitlist w WHERE w.org_id = v_org)
    );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_ai_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_status() TO anon, authenticated, service_role;

-- ── 5. join_ai_waitlist ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_ai_waitlist()
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_org UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;
    -- Only while Royal AI is off: the list means "email me when it's on".
    IF ai_enabled_from((SELECT value FROM platform_status WHERE key = 'ai')) THEN
        RETURN jsonb_build_object('joined', false, 'reason', 'ai_on');
    END IF;
    v_org := ai_caller_org();
    IF v_org IS NULL THEN
        RETURN jsonb_build_object('joined', false, 'reason', 'no_org');
    END IF;
    -- An org emailed after an earlier outage goes back on the list, so "we'll email you"
    -- stays true this time too.
    INSERT INTO ai_waitlist (org_id, user_id) VALUES (v_org, v_uid)
    ON CONFLICT (org_id) DO UPDATE
        SET notified_at = NULL, user_id = EXCLUDED.user_id, joined_at = now()
        WHERE ai_waitlist.notified_at IS NOT NULL;
    RETURN jsonb_build_object('joined', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.join_ai_waitlist() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.join_ai_waitlist() FROM anon;
GRANT EXECUTE ON FUNCTION public.join_ai_waitlist() TO authenticated;

-- ── 6. report_ai_health (service role) ─────────────────────────────────────
-- Writes only when `available` actually changes. Returns true when it changed.
CREATE OR REPLACE FUNCTION public.report_ai_health(p_ok BOOLEAN, p_reason TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_changed BOOLEAN := false;
BEGIN
    UPDATE platform_status
    SET value = value || jsonb_build_object(
            'available', p_ok,
            'reason', CASE WHEN p_ok THEN NULL ELSE left(COALESCE(p_reason, 'other'), 40) END,
            'since', now()),
        updated_at = now()
    WHERE key = 'ai'
      AND COALESCE((value->>'available')::boolean, true) IS DISTINCT FROM p_ok
    RETURNING true INTO v_changed;
    RETURN COALESCE(v_changed, false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.report_ai_health(BOOLEAN, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.report_ai_health(BOOLEAN, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_ai_health(BOOLEAN, TEXT) TO service_role;

-- ── 7. claim_ai_probe (service role) ───────────────────────────────────────
-- True only in auto mode with the AI marked unavailable and no probe in the last 5 minutes.
-- Claiming stamps last_probe_at, so however often ai-health is called it probes at most
-- 12 times an hour, and never while Royal AI is up.
CREATE OR REPLACE FUNCTION public.claim_ai_probe()
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_claimed BOOLEAN := false;
BEGIN
    UPDATE platform_status
    SET value = value || jsonb_build_object('last_probe_at', now())
    WHERE key = 'ai'
      AND COALESCE(value->>'mode', 'auto') = 'auto'
      AND COALESCE((value->>'available')::boolean, true) = false
      AND (value->>'last_probe_at' IS NULL
           OR (value->>'last_probe_at')::timestamptz < now() - interval '5 minutes')
    RETURNING true INTO v_claimed;
    RETURN COALESCE(v_claimed, false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_ai_probe() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_ai_probe() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_probe() TO service_role;

-- ── 8. Cron ────────────────────────────────────────────────────────────────
-- No Authorization header: both functions are verify_jwt = false and need none.
SELECT cron.schedule(
    'ai-health-probe',
    '*/15 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/ai-health',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{"trigger":"cron"}'::jsonb
    ) AS request_id;
    $$
);

SELECT cron.schedule(
    'ai-waitlist-notify-hourly',
    '7 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/ai-waitlist-notify',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{"trigger":"cron"}'::jsonb
    ) AS request_id;
    $$
);

-- ── 9. Assertions ──────────────────────────────────────────────────────────
DO $$
DECLARE
    v_fn TEXT;
BEGIN
    IF has_table_privilege('anon', 'public.platform_status', 'SELECT')
       OR has_table_privilege('authenticated', 'public.platform_status', 'SELECT') THEN
        RAISE EXCEPTION 'platform_status is readable by a client role';
    END IF;
    IF has_table_privilege('anon', 'public.ai_waitlist', 'SELECT')
       OR has_table_privilege('authenticated', 'public.ai_waitlist', 'INSERT')
       OR has_table_privilege('authenticated', 'public.ai_waitlist', 'SELECT') THEN
        RAISE EXCEPTION 'ai_waitlist is reachable by a client role';
    END IF;

    IF NOT has_function_privilege('anon', 'public.get_ai_status()', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.get_ai_status()', 'EXECUTE') THEN
        RAISE EXCEPTION 'get_ai_status: anon/authenticated cannot execute it';
    END IF;
    IF has_function_privilege('anon', 'public.join_ai_waitlist()', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.join_ai_waitlist()', 'EXECUTE') THEN
        RAISE EXCEPTION 'join_ai_waitlist: wrong grants';
    END IF;

    FOREACH v_fn IN ARRAY ARRAY[
        'public.report_ai_health(boolean, text)',
        'public.claim_ai_probe()',
        'public.ai_enabled_from(jsonb)',
        'public.ai_caller_org()'
    ] LOOP
        IF has_function_privilege('anon', v_fn, 'EXECUTE')
           OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION '%: a client role can EXECUTE it', v_fn;
        END IF;
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-health-probe')
       OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-waitlist-notify-hourly') THEN
        RAISE EXCEPTION 'cron jobs were not scheduled';
    END IF;
END;
$$;
