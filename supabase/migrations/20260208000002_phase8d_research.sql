-- Phase 8D: External Research Support
-- Add metadata column for caching search results

-- Add metadata column to business_knowledge if not exists
ALTER TABLE business_knowledge ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Index for search cache lookups
CREATE INDEX IF NOT EXISTS idx_knowledge_search_cache
ON business_knowledge(organization_id, category, source_url)
WHERE category = 'search_cache';

-- Cleanup old cache entries (older than 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_search_cache()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    WITH deleted AS (
        DELETE FROM business_knowledge
        WHERE category = 'search_cache'
          AND created_at < NOW() - INTERVAL '7 days'
        RETURNING id
    )
    SELECT COUNT(*) INTO deleted_count FROM deleted;

    RETURN deleted_count;
END;
$$;
