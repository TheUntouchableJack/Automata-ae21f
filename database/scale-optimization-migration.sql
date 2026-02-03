-- =====================================================
-- SCALE OPTIMIZATION MIGRATION
-- Run this in Supabase SQL Editor
-- Addresses: N+1 queries, missing indexes, tag aggregation
-- =====================================================

-- =====================================================
-- 1. COMPOSITE INDEXES FOR SOFT-DELETE QUERIES
-- These dramatically speed up queries filtering by organization + deleted_at
-- =====================================================

-- Projects: Most queries filter by organization_id and check deleted_at IS NULL
CREATE INDEX IF NOT EXISTS idx_projects_org_deleted
    ON projects(organization_id, deleted_at);

-- Projects: For dashboard sorting by created_at
CREATE INDEX IF NOT EXISTS idx_projects_org_deleted_created
    ON projects(organization_id, deleted_at, created_at DESC);

-- Customers: Almost all queries filter by organization_id and deleted_at
CREATE INDEX IF NOT EXISTS idx_customers_org_deleted
    ON customers(organization_id, deleted_at);

-- Customers: For pagination with created_at sorting
CREATE INDEX IF NOT EXISTS idx_customers_org_deleted_created
    ON customers(organization_id, deleted_at, created_at DESC);

-- Automations: Queries join through projects but filter deleted_at locally
CREATE INDEX IF NOT EXISTS idx_automations_project_deleted
    ON automations(project_id, deleted_at);

-- Blog posts: For soft-delete filtering
CREATE INDEX IF NOT EXISTS idx_blog_posts_automation_deleted
    ON blog_posts(automation_id, deleted_at);

-- Automations: For archive + active filtering
CREATE INDEX IF NOT EXISTS idx_automations_archived_active
    ON automations(is_archived, is_active);


-- =====================================================
-- 2. GET UNIQUE CUSTOMER TAGS FUNCTION
-- Replaces: SELECT tags FROM customers WHERE org_id = X (loads ALL customer data)
-- Now: Returns just the distinct tags efficiently
-- =====================================================

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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- 3. GET ORGANIZATION USAGE COUNTS (OPTIMIZED)
-- Replaces 4 sequential queries with 1 efficient query
-- Returns project, automation, and customer counts
-- =====================================================

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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- 4. BATCH UPDATE CUSTOMERS FUNCTION
-- Replaces N+1 UPDATE loop in CSV import
-- Updates multiple customers in a single transaction
-- =====================================================

CREATE OR REPLACE FUNCTION batch_update_customers(
    p_updates JSONB  -- Array of {id, first_name, last_name, email, phone, company, tags, custom_data}
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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- 5. GET CUSTOMER STATS (OPTIMIZED)
-- Replaces 2 separate count queries in customers.js
-- Returns all stats in one query
-- =====================================================

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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- 6. INDEX FOR TAGS SEARCH (GIN index on array)
-- Enables fast filtering by tag
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_customers_tags
    ON customers USING GIN (tags);


-- =====================================================
-- 7. GRANT EXECUTE PERMISSIONS
-- Allow authenticated users to call these functions
-- =====================================================

GRANT EXECUTE ON FUNCTION get_unique_customer_tags(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_org_usage_counts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION batch_update_customers(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION get_customer_stats(UUID) TO authenticated;


-- =====================================================
-- VERIFICATION QUERIES (run to check indexes exist)
-- =====================================================

-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename IN ('projects', 'customers', 'automations', 'blog_posts')
-- ORDER BY tablename, indexname;
