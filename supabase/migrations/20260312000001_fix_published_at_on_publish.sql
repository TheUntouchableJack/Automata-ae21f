-- Fix: set published_at when publishing via blog review
-- Previously update_draft_article never set published_at, causing epoch dates.
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
    updated_at = NOW(),
    published_at = CASE
      WHEN p_status = 'published' AND published_at IS NULL THEN NOW()
      ELSE published_at
    END
  WHERE id = p_article_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Article not found: %', p_article_id;
  END IF;

  SELECT jsonb_build_object('id', id, 'status', status, 'updated_at', updated_at, 'published_at', published_at)
  INTO v_article
  FROM newsletter_articles
  WHERE id = p_article_id;

  RETURN v_article;
END;
$$;

REVOKE ALL ON FUNCTION update_draft_article(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION update_draft_article(UUID, TEXT, TEXT) TO authenticated;
