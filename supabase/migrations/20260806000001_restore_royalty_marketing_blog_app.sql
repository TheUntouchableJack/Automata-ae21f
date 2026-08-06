-- Restore the customer_apps row that the royaltyapp.ai marketing blog hangs off.
--
-- WHY THIS EXISTS
-- ---------------
-- newsletter_articles.app_id is  NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE.
-- The 'royalty-marketing' row (d0229946-0812-4a96-acc4-0344613ee8b1) was deleted at some
-- point after 20260313000002, and the cascade took every article on the marketing blog
-- with it. That is why /blog/ has been serving "No posts yet" and why any article import
-- fails with 23503 (foreign key violation) until this row is back.
--
-- WHAT THE ROW HAS TO SATISFY
-- ---------------------------
--   blog/blog.js detectBlogSource():
--       slug='royalty-marketing' AND app_type='newsletter' AND is_active AND deleted_at IS NULL
--   RLS "Public can view published apps" (anon SELECT):
--       is_published = true AND is_active = true
-- Both must hold or the blog silently falls back to the empty blog_posts table.
--
-- Idempotent: safe to re-run. Restores the row if missing, un-deletes and re-points it
-- if present, and steps aside any other app squatting on the slug.

DO $$
DECLARE
  v_app_id uuid := 'd0229946-0812-4a96-acc4-0344613ee8b1';
  v_org_id uuid := 'd9986381-3a42-47b5-b65f-340d323b5e83';  -- "Royalty" org (slug 'royalty')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = v_org_id) THEN
    RAISE EXCEPTION
      'Royalty organization % is missing; recreate it before restoring the blog app', v_org_id;
  END IF;

  -- The slug is UNIQUE. If some other app holds it, move it out of the way rather than
  -- failing the migration.
  UPDATE customer_apps
     SET slug = slug || '-old-' || left(id::text, 8)
   WHERE slug = 'royalty-marketing'
     AND id <> v_app_id;

  INSERT INTO customer_apps (
    id, organization_id, name, slug, description, app_type,
    is_active, is_published, deleted_at, deleted_by
  ) VALUES (
    v_app_id, v_org_id,
    'Royalty Blog', 'royalty-marketing',
    'Marketing blog for royaltyapp.ai. Articles live in newsletter_articles.',
    'newsletter',
    true, true, NULL, NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    slug            = EXCLUDED.slug,
    app_type        = EXCLUDED.app_type,
    is_active       = true,
    is_published    = true,
    deleted_at      = NULL,
    deleted_by      = NULL,
    updated_at      = NOW();
END $$;

-- Leave the trap documented in the schema itself. Nothing else hints that removing one
-- customer_apps row destroys the entire blog.
COMMENT ON TABLE customer_apps IS
  'Customer-facing apps (loyalty, rewards, membership, newsletter, social). '
  'WARNING: newsletter_articles.app_id references this table ON DELETE CASCADE. '
  'Deleting the row with slug ''royalty-marketing'' (d0229946-0812-4a96-acc4-0344613ee8b1) '
  'permanently destroys every article on the royaltyapp.ai marketing blog. '
  'Soft-delete via deleted_at instead of DELETE.';

COMMENT ON COLUMN customer_apps.deleted_at IS
  'Soft-delete marker. Prefer setting this over DELETE: hard-deleting an app cascades to '
  'newsletter_articles and other child rows.';
