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

-- REMOVED 2026-08-06: a one-time data operation that bulk-published every draft
-- article for the royalty-marketing app (app_id d0229946-0812-4a96-acc4-0344613ee8b1).
--
-- It was applied once, in March 2026, and the rows it published were later
-- destroyed by the newsletter_articles -> customer_apps ON DELETE CASCADE, so it
-- has no targets left. What it does still have is blast radius: the statement was
-- unscoped by date or slug, so replaying this migration against any database
-- holding drafts would publish ALL of them — including unreviewed drafts with
-- incorrect pricing and unverified claims. Deleted rather than date-scoped
-- because there is nothing left for it to legitimately do.
--
-- Publishing is a human decision made in /app/blog-review.html. It does not
-- belong in schema migrations. Do not reintroduce a blanket UPDATE here.
--
-- The rest of this migration (CREATE OR REPLACE FUNCTION get_published_articles)
-- is idempotent and stays.
