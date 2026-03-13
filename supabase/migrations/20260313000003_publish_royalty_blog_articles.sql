-- Ensure get_published_articles function exists in the production DB.
-- This function lives in database/newsletter-migration.sql but was never
-- formally migrated — adding it here so it's guaranteed to exist.
CREATE OR REPLACE FUNCTION get_published_articles(
    p_app_id UUID,
    p_language TEXT DEFAULT 'en',
    p_topic TEXT DEFAULT NULL,
    p_series_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_articles JSONB;
    v_total INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total
    FROM newsletter_articles
    WHERE app_id = p_app_id
      AND language = p_language
      AND status = 'published'
      AND deleted_at IS NULL
      AND (p_topic IS NULL OR primary_topic = p_topic)
      AND (p_series_id IS NULL OR series_id = p_series_id);

    SELECT jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'title', a.title,
            'slug', a.slug,
            'excerpt', a.excerpt,
            'og_image_url', a.og_image_url,
            'primary_topic', a.primary_topic,
            'tags', a.tags,
            'published_at', a.published_at,
            'series', CASE WHEN a.series_id IS NOT NULL THEN
                jsonb_build_object(
                    'id', s.id,
                    'title', s.title,
                    'slug', s.slug,
                    'order', a.series_order
                )
            ELSE NULL END
        ) ORDER BY a.published_at DESC
    ) INTO v_articles
    FROM newsletter_articles a
    LEFT JOIN article_series s ON a.series_id = s.id
    WHERE a.app_id = p_app_id
      AND a.language = p_language
      AND a.status = 'published'
      AND a.deleted_at IS NULL
      AND (p_topic IS NULL OR a.primary_topic = p_topic)
      AND (p_series_id IS NULL OR a.series_id = p_series_id)
    LIMIT p_limit OFFSET p_offset;

    RETURN jsonb_build_object('total', v_total, 'articles', COALESCE(v_articles, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION get_published_articles(UUID, TEXT, TEXT, UUID, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION get_published_articles(UUID, TEXT, TEXT, UUID, INTEGER, INTEGER) TO anon, authenticated;

-- Publish all draft articles for the royalty-marketing blog.
-- Articles were loaded via Python CLI which defaults to status='draft'.
-- This bulk-publishes them so they appear on royaltyapp.ai/blog.
UPDATE newsletter_articles
SET
    status       = 'published',
    published_at = COALESCE(published_at, NOW())
WHERE app_id    = 'd0229946-0812-4a96-acc4-0344613ee8b1'::uuid
  AND status    = 'draft'
  AND deleted_at IS NULL;
