-- =====================================================
-- SOFT DELETE MIGRATION
-- Enables 1-hour recovery window for deleted items
-- Copy and paste this entire file into Supabase SQL Editor
-- =====================================================

-- 1. ADD SOFT DELETE COLUMNS TO TABLES

-- Projects
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES profiles(id);

-- Automations
ALTER TABLE automations
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES profiles(id);

-- Customers
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES profiles(id);

-- Blog Posts
ALTER TABLE blog_posts
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES profiles(id);

-- Project-Customer Links (for quick undo without confirmation modal)
ALTER TABLE project_customers
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES profiles(id);

-- 2. CREATE INDEXES FOR SOFT DELETE QUERIES
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_automations_deleted_at ON automations(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_deleted_at ON customers(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blog_posts_deleted_at ON blog_posts(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_customers_deleted_at ON project_customers(deleted_at) WHERE deleted_at IS NOT NULL;

-- 3. CREATE VIEWS FOR ACTIVE (NON-DELETED) ITEMS
-- These can be used as drop-in replacements for direct table queries

CREATE OR REPLACE VIEW active_projects AS
SELECT * FROM projects WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_automations AS
SELECT * FROM automations WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_customers AS
SELECT * FROM customers WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_blog_posts AS
SELECT * FROM blog_posts WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_project_customers AS
SELECT * FROM project_customers WHERE deleted_at IS NULL;

-- 4. CREATE VIEW FOR RECENTLY DELETED ITEMS (within 1 hour)
CREATE OR REPLACE VIEW recoverable_items AS
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

-- 5. SOFT DELETE FUNCTION
-- Call this instead of DELETE to enable recovery
CREATE OR REPLACE FUNCTION soft_delete(
    p_table_name TEXT,
    p_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
    EXECUTE format(
        'UPDATE %I SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2 AND deleted_at IS NULL',
        p_table_name
    ) USING p_user_id, p_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RESTORE FUNCTION
-- Recover a soft-deleted item within the 1-hour window
CREATE OR REPLACE FUNCTION restore_deleted(
    p_table_name TEXT,
    p_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_deleted_at TIMESTAMPTZ;
BEGIN
    -- Check if item exists and is within recovery window
    EXECUTE format(
        'SELECT deleted_at FROM %I WHERE id = $1',
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
        'UPDATE %I SET deleted_at = NULL, deleted_by = NULL WHERE id = $1',
        p_table_name
    ) USING p_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. PERMANENT DELETE FUNCTION (for cleanup)
-- Permanently removes items past the 1-hour recovery window
CREATE OR REPLACE FUNCTION cleanup_soft_deleted() RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    v_deleted INTEGER;
BEGIN
    -- Delete expired projects
    DELETE FROM projects
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '1 hour';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_count := v_count + v_deleted;

    -- Delete expired automations
    DELETE FROM automations
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '1 hour';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_count := v_count + v_deleted;

    -- Delete expired customers
    DELETE FROM customers
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '1 hour';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_count := v_count + v_deleted;

    -- Delete expired blog posts
    DELETE FROM blog_posts
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '1 hour';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_count := v_count + v_deleted;

    -- Delete expired project-customer links
    DELETE FROM project_customers
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '1 hour';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_count := v_count + v_deleted;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. SCHEDULE CLEANUP (run every 15 minutes via pg_cron if available)
-- If pg_cron is enabled in your Supabase project:
-- SELECT cron.schedule('cleanup-soft-deleted', '*/15 * * * *', 'SELECT cleanup_soft_deleted()');

-- 9. GRANT PERMISSIONS
GRANT EXECUTE ON FUNCTION soft_delete(TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_deleted(TEXT, UUID) TO authenticated;

-- Done! Soft delete system is ready.
--
-- Usage from JavaScript:
--   Soft delete: await supabase.rpc('soft_delete', { p_table_name: 'projects', p_id: id, p_user_id: userId })
--   Restore:     await supabase.rpc('restore_deleted', { p_table_name: 'projects', p_id: id })
--
-- Or use UPDATE directly:
--   Soft delete: await supabase.from('projects').update({ deleted_at: new Date().toISOString(), deleted_by: userId }).eq('id', id)
--   Restore:     await supabase.from('projects').update({ deleted_at: null, deleted_by: null }).eq('id', id)
