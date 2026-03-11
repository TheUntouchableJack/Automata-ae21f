-- Blog Review RPCs
-- Admin-only functions for the in-app blog review workflow.
-- Drafts are already hidden from public by:
--   1. "Public can view published articles" RLS policy (status = 'published')
--   2. get_published_articles() RPC (WHERE status = 'published')
-- These functions add admin-only access to drafts.

-- ============================================================================
-- get_blog_review_count()
-- Returns count of draft articles needing review.
-- Used to populate the sidebar badge.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_blog_review_count()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admins can call this
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE
  ) THEN
    RETURN 0;
  END IF;

  RETURN (
    SELECT COUNT(*)::integer
    FROM newsletter_articles
    WHERE status = 'draft'
      AND deleted_at IS NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION get_blog_review_count() FROM anon;
GRANT EXECUTE ON FUNCTION get_blog_review_count() TO authenticated;

-- ============================================================================
-- get_draft_articles_for_review()
-- Returns draft articles for the blog review UI.
-- Aborts with error if caller is not admin.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_draft_articles_for_review()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Abort if caller is not admin
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'title', a.title,
        'slug', a.slug,
        'status', a.status,
        'primary_topic', a.primary_topic,
        'tags', a.tags,
        'meta_title', a.meta_title,
        'meta_description', a.meta_description,
        'content', a.content,
        'language', a.language,
        'created_at', a.created_at,
        'updated_at', a.updated_at
      ) ORDER BY a.created_at DESC
    ), '[]'::jsonb)
    FROM newsletter_articles a
    WHERE a.status = 'draft'
      AND a.deleted_at IS NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION get_draft_articles_for_review() FROM anon;
GRANT EXECUTE ON FUNCTION get_draft_articles_for_review() TO authenticated;

-- ============================================================================
-- update_draft_article(article_id, content, status)
-- Admin-only update for blog review saves and publishes.
-- ============================================================================
CREATE OR REPLACE FUNCTION update_draft_article(
  p_article_id UUID,
  p_content TEXT,
  p_status TEXT DEFAULT 'draft'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_article JSONB;
BEGIN
  -- Abort if caller is not admin
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Validate status
  IF p_status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  UPDATE newsletter_articles
  SET
    content = p_content,
    status = p_status,
    updated_at = NOW()
  WHERE id = p_article_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Article not found: %', p_article_id;
  END IF;

  SELECT jsonb_build_object('id', id, 'status', status, 'updated_at', updated_at)
  INTO v_article
  FROM newsletter_articles
  WHERE id = p_article_id;

  RETURN v_article;
END;
$$;

REVOKE ALL ON FUNCTION update_draft_article(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION update_draft_article(UUID, TEXT, TEXT) TO authenticated;
