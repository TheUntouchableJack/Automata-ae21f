-- Knowledge importance ranking + usage tracking
-- --------------------------------------------------------------------------
-- (a) Fix the TEXT-sort bug in prune_business_knowledge(). `importance` is a
--     TEXT column, so `ORDER BY importance DESC` sorts ALPHABETICALLY —
--     ranking 'medium' > 'low' > 'high' > 'critical'. The weekly prune was
--     therefore superseding CRITICAL facts while keeping MEDIUM ones whenever
--     an org+layer+category exceeded 5 active facts. Replace with an explicit
--     rank via CASE. No cron re-schedule — the existing schedule calls this
--     function by name (see 20260212000007).
-- (b) increment_knowledge_usage(): bump `times_used` for facts surfaced to the
--     AI, so usage becomes a real ranking signal (previously sorted-on but
--     never incremented).

CREATE OR REPLACE FUNCTION prune_business_knowledge()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expired INTEGER := 0;
  v_superseded INTEGER := 0;
BEGIN
  -- 1. Invalidate facts past their expires_at date
  UPDATE business_knowledge
  SET status = 'invalidated', updated_at = NOW()
  WHERE status = 'active'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- 2. Supersede older duplicate facts in the same category
  -- When multiple active facts exist for the same org+layer+category,
  -- keep only the 5 most important/recent, supersede the rest.
  -- importance is TEXT — rank explicitly so critical > high > medium > low.
  WITH ranked AS (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY organization_id, layer, category
        ORDER BY
          CASE importance
            WHEN 'critical' THEN 4
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 1
            ELSE 0
          END DESC,
          confidence DESC,
          created_at DESC
      ) as rn
    FROM business_knowledge
    WHERE status = 'active'
  )
  UPDATE business_knowledge bk
  SET status = 'superseded', updated_at = NOW()
  FROM ranked r
  WHERE bk.id = r.id
    AND r.rn > 5
    AND bk.status = 'active';
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  RETURN jsonb_build_object(
    'expired', v_expired,
    'superseded', v_superseded,
    'pruned_at', NOW()
  );
END;
$$;

COMMENT ON FUNCTION prune_business_knowledge IS 'Weekly cleanup: invalidate expired facts, supersede old duplicates (keep top 5 per org+layer+category, ranked by explicit importance CASE)';

-- --------------------------------------------------------------------------
-- (b) Usage counter: increment times_used for a batch of fact ids.
--     Called fire-and-forget from read_knowledge. SECURITY DEFINER so it works
--     regardless of the caller's RLS scope; only bumps the counter, never
--     touches fact content or updated_at (leaving staleness signals intact).

CREATE OR REPLACE FUNCTION increment_knowledge_usage(p_ids UUID[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE business_knowledge
  SET times_used = COALESCE(times_used, 0) + 1
  WHERE id = ANY(p_ids);
$$;

COMMENT ON FUNCTION increment_knowledge_usage IS 'Increment times_used for facts surfaced to the AI (usage ranking signal)';

GRANT EXECUTE ON FUNCTION increment_knowledge_usage(UUID[]) TO authenticated, service_role;
