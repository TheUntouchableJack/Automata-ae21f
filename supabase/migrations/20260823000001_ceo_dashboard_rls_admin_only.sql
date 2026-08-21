-- self_growth_config, self_growth_log, outreach_queue were left open to any
-- authenticated user via "USING (true)" policies. Replace with the same
-- is_admin = true pattern already used by royal_tasks / content_queue.

DROP POLICY IF EXISTS "authenticated can read config" ON self_growth_config;
DROP POLICY IF EXISTS "authenticated can update config status" ON self_growth_config;

DROP POLICY IF EXISTS "authenticated can read growth log" ON self_growth_log;
DROP POLICY IF EXISTS "authenticated can approve or skip tasks" ON self_growth_log;

DROP POLICY IF EXISTS "authenticated can read outreach queue" ON outreach_queue;
DROP POLICY IF EXISTS "authenticated can update outreach status" ON outreach_queue;

CREATE POLICY "admin full access to config"
  ON self_growth_config FOR ALL
  TO authenticated
  USING (exists (select 1 from profiles where id = auth.uid() and is_admin = true))
  WITH CHECK (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

CREATE POLICY "admin full access to growth log"
  ON self_growth_log FOR ALL
  TO authenticated
  USING (exists (select 1 from profiles where id = auth.uid() and is_admin = true))
  WITH CHECK (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

CREATE POLICY "admin full access to outreach queue"
  ON outreach_queue FOR ALL
  TO authenticated
  USING (exists (select 1 from profiles where id = auth.uid() and is_admin = true))
  WITH CHECK (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

-- service_role full-access policies ("service role full access to config" /
-- "growth log" / "outreach queue") are untouched.
