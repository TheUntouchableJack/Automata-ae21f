-- Fix Supabase Security Advisor warnings
-- 1. Views: set security_invoker = on (so they respect RLS)
-- 2. Drop cron_job_status (queries cron.job system table, incompatible)
-- 3. 24hd proposal functions: add search_path to prevent path hijacking

-- ============================================================
-- PART 1: Drop cron_job_status
-- ============================================================
REVOKE SELECT ON cron_job_status FROM authenticated;
DROP VIEW IF EXISTS cron_job_status;

-- ============================================================
-- PART 2: Set security_invoker = on for all public views
-- ============================================================
-- Soft-delete convenience views
ALTER VIEW IF EXISTS active_projects SET (security_invoker = on);
ALTER VIEW IF EXISTS active_automations SET (security_invoker = on);
ALTER VIEW IF EXISTS active_customers SET (security_invoker = on);
ALTER VIEW IF EXISTS active_blog_posts SET (security_invoker = on);
ALTER VIEW IF EXISTS active_project_customers SET (security_invoker = on);
ALTER VIEW IF EXISTS recoverable_items SET (security_invoker = on);

-- Automation templates
ALTER VIEW IF EXISTS automation_templates SET (security_invoker = on);

-- AI cost monitoring views
ALTER VIEW IF EXISTS v_ai_cost_summary SET (security_invoker = on);
ALTER VIEW IF EXISTS v_ai_cost_anomalies SET (security_invoker = on);
ALTER VIEW IF EXISTS v_ai_top_consumers SET (security_invoker = on);

-- Audit summary
ALTER VIEW IF EXISTS audit_summary SET (security_invoker = on);

-- ============================================================
-- PART 3: search_path for 24hd proposal functions (new, easy win)
-- ============================================================
-- Using 'public' (not '') so existing unqualified table refs still resolve
ALTER FUNCTION save_visitor_signature(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) SET search_path = 'public';
ALTER FUNCTION get_visitor_signature(UUID, TEXT) SET search_path = 'public';
ALTER FUNCTION upsert_feature_approval(TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) SET search_path = 'public';
ALTER FUNCTION get_feature_approvals(TEXT) SET search_path = 'public';
