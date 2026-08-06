-- Migration: Blog language fallback + the missing article columns
-- ---------------------------------------------------------------
-- Two problems, both visible to a non-English visitor today:
--
--   1. Every article in newsletter_articles is language='en'. Both blog RPCs
--      filter on p_language with no fallback, so a French visitor gets total=0
--      and an empty blog. blog/blog.js has masked this by always sending 'en'
--      (its two language-detection fallbacks reference names that do not exist —
--      window.i18n vs the exported window.I18n, and localStorage 'language' vs
--      the written 'royalty_language'). Fixing those client bugs on their own
--      would CAUSE the empty blog. The fallback has to land here first.
--
--   2. get_article_by_slug never returned author_name, author_title,
--      og_image_alt, og_image_credit or og_image_credit_url, so the byline and
--      hero credit are missing everywhere the RPC is the only source —
--      /app/blog-review.html most visibly. scripts/prerender-blog.mjs works
--      around this with a second REST read; that stays, and now agrees.
--
-- get_article_by_slug has never had a migration file — this is its first
-- tracked definition. It exists in prod from two hand-applied sources:
-- database/newsletter-migration.sql:690 (SECURITY DEFINER) and
-- database/supabase-security-views-functions.sql:3197 (SECURITY INVOKER). The
-- two are byte-identical apart from that one line. We deliberately take the
-- INVOKER form: prod almost certainly runs it, it relies on the "Public can
-- view published articles" RLS policy that anon already reads through, and
-- switching to DEFINER would silently widen access to unpublished rows.
-- SET search_path = public is added to both regardless —
-- database/supabase-linter-verify.sql:37-39 asserts on it.
--
-- No DROP needed for either function: return type stays JSONB and no argument
-- changes, so CREATE OR REPLACE is sufficient.
--
-- ⚠️ Apply via the ISOLATED single-migration pattern (not a bare `supabase db
--    push`, which would carry the three un-pushed riders:
--    20260414000002_signup_notify_webhook.sql, 20260722000001_admin_get_all_apps.sql
--    and 20260725000001_recommendation_pipeline.sql).

-- ============================================================================
-- get_published_articles — resolve the effective language once, up front
-- ============================================================================
-- The probe carries the SAME topic/series predicates as the queries below it.
-- Without them, a French visitor on an empty "AI Insights" tab would resolve to
-- 'fr' (because some French article exists somewhere), then get a count and a
-- row set that disagree. Resolving once also guarantees total and articles can
-- never be computed against different languages.
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
    v_lang TEXT;
BEGIN
    v_lang := CASE WHEN EXISTS (
        SELECT 1 FROM newsletter_articles
        WHERE app_id = p_app_id
          AND language = p_language
          AND status = 'published'
          AND deleted_at IS NULL
          AND (p_topic IS NULL OR primary_topic = p_topic)
          AND (p_series_id IS NULL OR series_id = p_series_id)
    ) THEN p_language ELSE 'en' END;

    SELECT COUNT(*) INTO v_total
    FROM newsletter_articles
    WHERE app_id = p_app_id
      AND language = v_lang
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
      AND a.language = v_lang
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

-- ============================================================================
-- get_article_by_slug — fall back to the English article, then stay consistent
-- ============================================================================
CREATE OR REPLACE FUNCTION get_article_by_slug(
    p_app_id UUID,
    p_slug TEXT,
    p_language TEXT DEFAULT 'en'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_article newsletter_articles%ROWTYPE;
    v_result JSONB;
    v_series JSONB;
    v_prev_in_series JSONB;
    v_next_in_series JSONB;
    v_related JSONB;
    v_translations JSONB;
BEGIN
    -- Get article
    SELECT * INTO v_article
    FROM newsletter_articles
    WHERE app_id = p_app_id
      AND slug = p_slug
      AND language = p_language
      AND status = 'published'
      AND deleted_at IS NULL;

    -- Fall back to the English article of the same slug. Every article is
    -- currently 'en', so without this a non-English caller gets "not found" for
    -- an article that plainly exists.
    IF v_article.id IS NULL AND p_language <> 'en' THEN
        SELECT * INTO v_article
        FROM newsletter_articles
        WHERE app_id = p_app_id
          AND slug = p_slug
          AND language = 'en'
          AND status = 'published'
          AND deleted_at IS NULL;
    END IF;

    IF v_article.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Article not found'
        );
    END IF;

    -- Everything below filters on v_article.language, NOT p_language. After a
    -- fallback those differ, and filtering the series/related queries by a
    -- language the resolved article is not in returns empty lists on every
    -- fallback hit.
    IF v_article.series_id IS NOT NULL THEN
        SELECT jsonb_build_object(
            'id', s.id,
            'title', s.title,
            'slug', s.slug,
            'article_count', s.article_count
        ) INTO v_series
        FROM article_series s
        WHERE s.id = v_article.series_id;

        -- Get prev/next in series
        SELECT jsonb_build_object(
            'title', title,
            'slug', slug
        ) INTO v_prev_in_series
        FROM newsletter_articles
        WHERE series_id = v_article.series_id
          AND series_order = v_article.series_order - 1
          AND language = v_article.language
          AND status = 'published'
          AND deleted_at IS NULL;

        SELECT jsonb_build_object(
            'title', title,
            'slug', slug
        ) INTO v_next_in_series
        FROM newsletter_articles
        WHERE series_id = v_article.series_id
          AND series_order = v_article.series_order + 1
          AND language = v_article.language
          AND status = 'published'
          AND deleted_at IS NULL;
    END IF;

    -- Get related articles
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'title', a.title,
            'slug', a.slug,
            'excerpt', a.excerpt,
            'og_image_url', a.og_image_url
        )
    ) INTO v_related
    FROM newsletter_articles a
    WHERE a.app_id = p_app_id
      AND a.language = v_article.language
      AND a.status = 'published'
      AND a.deleted_at IS NULL
      AND a.id != v_article.id
      AND (
          a.id = ANY(v_article.related_article_ids)
          OR a.primary_topic = v_article.primary_topic
          OR a.tags && v_article.tags
      )
    LIMIT 5;

    -- Get translations.
    -- Deliberately NOT language-filtered: this is the list of OTHER languages
    -- this article exists in, and it feeds the hreflang tags in
    -- blog/blog.js:445-462. Left exactly as it was.
    SELECT jsonb_agg(
        jsonb_build_object(
            'language', a.language,
            'slug', a.slug,
            'title', a.title
        )
    ) INTO v_translations
    FROM newsletter_articles a
    WHERE a.status = 'published'
      AND a.deleted_at IS NULL
      AND (
          (v_article.is_primary_language AND a.primary_article_id = v_article.id)
          OR (NOT v_article.is_primary_language AND (a.id = v_article.primary_article_id OR a.primary_article_id = v_article.primary_article_id))
      )
      AND a.id != v_article.id;

    -- Build result
    v_result := jsonb_build_object(
        'success', true,
        'article', jsonb_build_object(
            'id', v_article.id,
            'title', v_article.title,
            'slug', v_article.slug,
            'excerpt', v_article.excerpt,
            'content', v_article.content,
            'content_html', v_article.content_html,
            'meta_title', v_article.meta_title,
            'meta_description', v_article.meta_description,
            'canonical_url', v_article.canonical_url,
            'og_image_url', v_article.og_image_url,
            -- Added: the hero image's alt/credit and the author byline. The
            -- SELECT * above already loaded them; they were simply never
            -- projected into the result.
            'og_image_alt', v_article.og_image_alt,
            'og_image_credit', v_article.og_image_credit,
            'og_image_credit_url', v_article.og_image_credit_url,
            'author_name', v_article.author_name,
            'author_title', v_article.author_title,
            'schema_json', v_article.schema_json,
            'primary_topic', v_article.primary_topic,
            'tags', v_article.tags,
            'language', v_article.language,
            'published_at', v_article.published_at,
            'updated_at', v_article.updated_at
        ),
        'series', v_series,
        'prev_in_series', v_prev_in_series,
        'next_in_series', v_next_in_series,
        'related', COALESCE(v_related, '[]'::jsonb),
        'translations', COALESCE(v_translations, '[]'::jsonb)
    );

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_article_by_slug(UUID, TEXT, TEXT) TO anon, authenticated;
