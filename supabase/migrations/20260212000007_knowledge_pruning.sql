-- Knowledge Pruning Function
-- Cleans up expired, stale, and superseded knowledge entries

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
  -- keep only the 5 most important/recent, supersede the rest
  WITH ranked AS (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY organization_id, layer, category
        ORDER BY importance DESC, confidence DESC, created_at DESC
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

-- Schedule weekly pruning (Sunday 4 AM UTC, offset from other crons)
SELECT cron.schedule(
  'prune-business-knowledge',
  '0 4 * * 0',
  $$ SELECT prune_business_knowledge(); $$
);

COMMENT ON FUNCTION prune_business_knowledge IS 'Weekly cleanup: invalidate expired facts, supersede old duplicates (keep top 5 per org+layer+category)';
