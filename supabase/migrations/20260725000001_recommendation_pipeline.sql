-- Migration: Recommendation Pipeline (Royal AI Phase 3)
-- ------------------------------------------------------
-- Two independent pieces, one isolated migration:
--   3A cron: daily fire of the royal-ai-recommend edge function (knowledge-driven
--            recommendation generator that INSERTs into ai_recommendations).
--   3B glue: survey answers written to `projects` get mirrored into
--            `business_profiles` (NULL-only, idempotent) so the generator — and
--            the chat-drip discovery scorer (get_next_discovery_question_v2) —
--            actually see them. This is what makes 3C convergence emergent:
--            once these profile fields fill, the drip stops re-asking (the +30
--            knowledge-gap bonus for those maps_to_field questions disappears).
--
-- ⚠️ Apply via the ISOLATED single-migration pattern (not a bare `supabase db push`
--    which would re-run hand-applied RPCs and carry the un-pushed
--    20260414000002_signup_notify_webhook.sql rider). See
--    project-automata-viibeview-all-apps-admin-tab memory.

-- ============================================================================
-- 3B. Survey (projects) → business_profiles mapping
-- ============================================================================
-- The Intelligence survey writes to projects columns (target_age_range,
-- retention_driver, competitors, current_challenge, success_vision). Mirror
-- those into the matching business_profiles fields, filling ONLY when the target
-- is empty so we never clobber richer data gathered elsewhere.
--
-- NOTE: avg_transaction is intentionally NOT mapped here — it lives on
-- organizations.avg_transaction_value, not on projects (verified against
-- 20260206200000_business_intel_fields.sql). Map only present columns.

CREATE OR REPLACE FUNCTION sync_project_survey_to_profile()
RETURNS TRIGGER AS $$
BEGIN
    -- Only act if the survey actually contributed at least one mapped field.
    IF NEW.target_age_range IS NULL
       AND NEW.retention_driver IS NULL
       AND NEW.competitors IS NULL
       AND NEW.current_challenge IS NULL
       AND NEW.success_vision IS NULL THEN
        RETURN NEW;
    END IF;

    -- Ensure a profile row exists for the org (no-op if already present).
    INSERT INTO business_profiles (organization_id)
    VALUES (NEW.organization_id)
    ON CONFLICT (organization_id) DO NOTHING;

    -- NULL-only fills (competitors: primary_competitors defaults to '[]'::jsonb,
    -- so treat empty-array as fillable too). Stored as the documented
    -- [{name, ...}] jsonb shape.
    UPDATE business_profiles bp SET
        primary_age_range = COALESCE(bp.primary_age_range, NEW.target_age_range),
        competitive_advantage = COALESCE(bp.competitive_advantage, NEW.retention_driver),
        biggest_challenge = COALESCE(bp.biggest_challenge, NEW.current_challenge),
        success_vision = COALESCE(bp.success_vision, NEW.success_vision),
        primary_competitors = CASE
            WHEN (bp.primary_competitors IS NULL OR bp.primary_competitors = '[]'::jsonb)
                 AND NEW.competitors IS NOT NULL
            THEN jsonb_build_array(jsonb_build_object('name', NEW.competitors))
            ELSE bp.primary_competitors
        END,
        updated_at = NOW()
    WHERE bp.organization_id = NEW.organization_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_project_survey_to_profile ON projects;
CREATE TRIGGER trg_sync_project_survey_to_profile
    AFTER INSERT OR UPDATE OF target_age_range, retention_driver, competitors, current_challenge, success_vision
    ON projects
    FOR EACH ROW
    EXECUTE FUNCTION sync_project_survey_to_profile();

-- One-time NULL-only backfill for existing orgs whose survey answers predate the trigger.
INSERT INTO business_profiles (organization_id)
SELECT DISTINCT p.organization_id
FROM projects p
WHERE p.organization_id IS NOT NULL
  AND (p.target_age_range IS NOT NULL OR p.retention_driver IS NOT NULL
       OR p.competitors IS NOT NULL OR p.current_challenge IS NOT NULL
       OR p.success_vision IS NOT NULL)
ON CONFLICT (organization_id) DO NOTHING;

WITH survey AS (
    -- One representative (most recent) survey-bearing project per org.
    SELECT DISTINCT ON (p.organization_id)
        p.organization_id,
        p.target_age_range,
        p.retention_driver,
        p.competitors,
        p.current_challenge,
        p.success_vision
    FROM projects p
    WHERE p.organization_id IS NOT NULL
      AND (p.target_age_range IS NOT NULL OR p.retention_driver IS NOT NULL
           OR p.competitors IS NOT NULL OR p.current_challenge IS NOT NULL
           OR p.success_vision IS NOT NULL)
    ORDER BY p.organization_id, p.created_at DESC
)
UPDATE business_profiles bp SET
    primary_age_range = COALESCE(bp.primary_age_range, s.target_age_range),
    competitive_advantage = COALESCE(bp.competitive_advantage, s.retention_driver),
    biggest_challenge = COALESCE(bp.biggest_challenge, s.current_challenge),
    success_vision = COALESCE(bp.success_vision, s.success_vision),
    primary_competitors = CASE
        WHEN (bp.primary_competitors IS NULL OR bp.primary_competitors = '[]'::jsonb)
             AND s.competitors IS NOT NULL
        THEN jsonb_build_array(jsonb_build_object('name', s.competitors))
        ELSE bp.primary_competitors
    END,
    updated_at = NOW()
FROM survey s
WHERE bp.organization_id = s.organization_id;

-- ============================================================================
-- 3A cron. Daily 5AM UTC (offset from the Sun-4AM knowledge prune) → fire the
-- royal-ai-recommend generator in cron mode (empty body = all eligible orgs).
-- Cloned from 20260208000006_cron_autonomous_runner.sql.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotent: drop any prior schedule of the same name before re-creating.
-- (FROM cron.job yields zero rows — and thus no unschedule call — when absent.)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'royal-ai-recommend-daily';

SELECT cron.schedule(
  'royal-ai-recommend-daily',
  '0 5 * * *',                         -- Daily at 5 AM UTC
  $$
  SELECT net.http_post(
    url := 'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/royal-ai-recommend',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
