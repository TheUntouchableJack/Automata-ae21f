-- Check-in works: the member_visits trigger no longer throws (2026-11-22)
--
-- Found by the live walkthrough (plan cool-anything-here-wiggly-valiant, step 1): a signed-in
-- member's check_in() returned 55000 'record "v_member" is not assigned yet' and rolled back.
--
-- Cause: trigger_automation_visit() (20260210000001, AFTER INSERT ON member_visits) did
--     SELECT ... INTO v_org_id, v_member.tier, v_member.visit_count, v_member.current_streak
-- on a RECORD that was never assigned. PL/pgSQL refuses to assign a field of an unassigned
-- record, so EVERY insert into member_visits has failed since February: no QR check-in in
-- production ever recorded a visit. The B1a PGlite harness had no such trigger, so it passed.
--
-- Fix: the same lookup into plain variables, the same event body. And the automation hook is an
-- optional side effect: whatever goes wrong inside it (pg_net, settings, a missing row) is now a
-- WARNING, never a lost visit.
--
-- The other three automation triggers in 20260210000001 assign plain variables and are untouched.
-- CREATE OR REPLACE keeps the function's OID, so the automation_visit trigger and the
-- service_role grant stay as they are.

DO $$
BEGIN
    IF to_regprocedure('public.trigger_automation_visit()') IS NULL THEN
        RAISE EXCEPTION 'pre-flight: trigger_automation_visit() is missing.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'member_visits' AND t.tgname = 'automation_visit' AND NOT t.tgisinternal
    ) THEN
        RAISE NOTICE 'pre-flight: trigger automation_visit is not on member_visits (nothing calls the function).';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.trigger_automation_visit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_supabase_url TEXT;
    v_service_key TEXT;
    v_org_id UUID;
    v_tier TEXT;
    v_visit_count INTEGER;
    v_streak INTEGER;
BEGIN
    BEGIN
        v_supabase_url := current_setting('app.settings.supabase_url', true);
        v_service_key := current_setting('app.settings.service_role_key', true);

        SELECT ca.organization_id, am.tier, am.visit_count, am.current_streak
          INTO v_org_id, v_tier, v_visit_count, v_streak
        FROM customer_apps ca
        JOIN app_members am ON am.app_id = ca.id AND am.id = NEW.member_id
        WHERE ca.id = NEW.app_id;

        PERFORM net.http_post(
            url := COALESCE(v_supabase_url, 'https://vhpmmfhfwnpmavytoomd.supabase.co') || '/functions/v1/automation-engine',
            headers := jsonb_build_object(
                'Authorization', 'Bearer ' || COALESCE(v_service_key, current_setting('supabase.service_role_key', true)),
                'Content-Type', 'application/json'
            ),
            body := jsonb_build_object(
                'type', 'event',
                'event_name', 'visit',
                'organization_id', v_org_id,
                'app_id', NEW.app_id,
                'member_id', NEW.member_id,
                'event_data', jsonb_build_object(
                    'visit_count', COALESCE(v_visit_count, 0) + 1,
                    'streak', v_streak,
                    'tier', v_tier,
                    'points_awarded', NEW.points_awarded,
                    'streak_bonus', NEW.streak_bonus,
                    'milestone_bonus', NEW.milestone_bonus
                )
            )
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'trigger_automation_visit: automation hook skipped for member %: % (%)',
            NEW.member_id, SQLERRM, SQLSTATE;
    END;

    RETURN NEW;
END;
$$;
