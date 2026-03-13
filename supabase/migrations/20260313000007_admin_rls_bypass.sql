-- Allow admin to read all newsletter articles (bypasses org membership requirement)
-- Fixes 401 errors on CEO dashboard HEAD count queries
CREATE POLICY "Admin can read all newsletter articles"
  ON newsletter_articles FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
