-- =====================================================
-- SUPABASE LINTER VERIFICATION QUERIES
-- File 3 of 3: Verify all fixes applied correctly
-- Run this in Supabase SQL Editor AFTER Files 1 and 2
-- Generated: 2026-02-05
-- =====================================================

-- =====================================================
-- 1. CHECK: Views have security_invoker set
-- Expected: All 6 views should appear with security_invoker = true
-- =====================================================

SELECT
    schemaname,
    viewname,
    (obj_description((schemaname || '.' || viewname)::regclass, 'pg_class') IS NOT NULL) as has_comment,
    -- Check security_invoker via pg_views and reloptions
    EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = schemaname
        AND c.relname = viewname
        AND c.reloptions @> ARRAY['security_invoker=on']
    ) as security_invoker_on
FROM pg_views
WHERE schemaname = 'public'
AND viewname IN (
    'active_projects',
    'active_automations',
    'active_customers',
    'active_blog_posts',
    'active_project_customers',
    'recoverable_items'
)
ORDER BY viewname;

-- =====================================================
-- 2. CHECK: All SECURITY DEFINER functions have search_path set
-- Expected: 0 rows (no SECURITY DEFINER functions without search_path)
-- =====================================================

SELECT
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as arguments,
    p.prosecdef as is_security_definer,
    array_to_string(p.proconfig, ', ') as config
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
AND p.prosecdef = true  -- SECURITY DEFINER
AND (
    p.proconfig IS NULL
    OR NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) c
        WHERE c LIKE 'search_path=%'
    )
)
ORDER BY p.proname;

-- =====================================================
-- 3. CHECK: Functions that should be SECURITY INVOKER
-- These should NOT appear as SECURITY DEFINER
-- Expected: 0 rows
-- =====================================================

SELECT
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as arguments,
    'Should be SECURITY INVOKER but is SECURITY DEFINER' as issue
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
AND p.prosecdef = true
AND p.proname IN (
    'create_industry_fields',
    'get_pending_recommendations',
    'dismiss_recommendation',
    'implement_recommendation',
    'get_org_analysis_data',
    'get_ai_weekly_summary',
    'get_app_stats',
    'get_support_stats',
    'get_app_dashboard_summary',
    'get_member_growth',
    'get_recent_activity',
    'get_visit_trend',
    'get_org_dashboard_summary',
    'get_published_articles',
    'get_article_by_slug',
    'save_content_context',
    'add_competitor_for_research',
    'get_content_generation_stats',
    'get_unread_notification_count',
    'mark_notification_read',
    'mark_all_notifications_read',
    'get_recent_notifications',
    'get_organization_billing',
    'get_unique_customer_tags',
    'get_org_usage_counts',
    'batch_update_customers',
    'get_customer_stats'
)
ORDER BY p.proname;

-- =====================================================
-- 4. CHECK: No bare auth.uid() in RLS policies
-- Expected: 0 rows (all should use (SELECT auth.uid()))
-- =====================================================

SELECT
    schemaname,
    tablename,
    policyname,
    'Contains bare auth.uid() — should use (SELECT auth.uid())' as issue
FROM pg_policies
WHERE schemaname = 'public'
AND (
    qual LIKE '%auth.uid()%'
    OR with_check LIKE '%auth.uid()%'
)
AND NOT (
    qual LIKE '%(select auth.uid())%'
    OR qual LIKE '%(SELECT auth.uid())%'
    OR qual IS NULL
)
AND NOT (
    with_check LIKE '%(select auth.uid())%'
    OR with_check LIKE '%(SELECT auth.uid())%'
    OR with_check IS NULL
)
ORDER BY tablename, policyname;

-- =====================================================
-- 5. CHECK: All FK columns have indexes
-- Expected: 0 rows (no unindexed FK columns)
-- =====================================================

WITH fk_columns AS (
    SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
),
indexed_columns AS (
    SELECT
        t.relname AS table_name,
        a.attname AS column_name
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
    -- Only count indexes where the FK column is the first column
    AND a.attnum = i.indkey[0]
)
SELECT
    fk.table_name,
    fk.column_name,
    fk.foreign_table,
    'Missing index on FK column' as issue
FROM fk_columns fk
LEFT JOIN indexed_columns ic
    ON fk.table_name = ic.table_name
    AND fk.column_name = ic.column_name
WHERE ic.column_name IS NULL
ORDER BY fk.table_name, fk.column_name;

-- =====================================================
-- 6. SUMMARY: Count of all items checked
-- =====================================================

SELECT 'Views with security_invoker' as check_type,
    COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'public'
        AND c.relname = v.viewname
        AND c.reloptions @> ARRAY['security_invoker=on']
    )) as passing,
    COUNT(*) as total
FROM pg_views v
WHERE v.schemaname = 'public'
AND v.viewname IN ('active_projects','active_automations','active_customers','active_blog_posts','active_project_customers','recoverable_items')

UNION ALL

SELECT 'SECURITY DEFINER functions with search_path' as check_type,
    COUNT(*) FILTER (WHERE p.proconfig IS NOT NULL AND EXISTS (
        SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'
    )) as passing,
    COUNT(*) as total
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.prosecdef = true

UNION ALL

SELECT 'RLS policies using (SELECT auth.uid())' as check_type,
    COUNT(*) FILTER (WHERE
        (qual IS NULL OR qual LIKE '%(select auth.uid())%' OR qual LIKE '%(SELECT auth.uid())%' OR qual NOT LIKE '%auth.uid()%')
        AND
        (with_check IS NULL OR with_check LIKE '%(select auth.uid())%' OR with_check LIKE '%(SELECT auth.uid())%' OR with_check NOT LIKE '%auth.uid()%')
    ) as passing,
    COUNT(*) as total
FROM pg_policies
WHERE schemaname = 'public'
AND (qual LIKE '%auth.uid()%' OR with_check LIKE '%auth.uid()%');

-- =====================================================
-- DONE! Review results above.
-- All "Expected: 0 rows" queries should return empty.
-- Summary should show passing = total for each check.
-- =====================================================
