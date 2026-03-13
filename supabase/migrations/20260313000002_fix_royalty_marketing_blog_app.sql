-- Fix the royalty-marketing newsletter app so detectBlogSource() can find it.
-- The customer_apps row already exists (FK required for newsletter_articles),
-- but its slug/app_type don't match what blog.js expects.
--
-- blog.js detectBlogSource() queries:
--   WHERE slug='royalty-marketing' AND app_type='newsletter' AND is_active=true AND deleted_at IS NULL
--
-- ROYALTY_APP_ID = d0229946-0812-4a96-acc4-0344613ee8b1

DO $$
BEGIN
  -- If another app already owns the slug 'royalty-marketing', rename it first
  UPDATE customer_apps
  SET slug = slug || '-old'
  WHERE slug = 'royalty-marketing'
    AND id <> 'd0229946-0812-4a96-acc4-0344613ee8b1'::uuid;

  -- Update the target app to match what detectBlogSource() looks for
  UPDATE customer_apps
  SET
    slug       = 'royalty-marketing',
    app_type   = 'newsletter',
    is_active  = true,
    deleted_at = null
  WHERE id = 'd0229946-0812-4a96-acc4-0344613ee8b1'::uuid;
END $$;
