-- V3.1: Knowledge Score — per-layer completeness scoring
-- Enables the "AI Understanding" widget on the Learnings tab

CREATE OR REPLACE FUNCTION get_knowledge_score(p_org_id UUID)
RETURNS TABLE (
    layer TEXT,
    fact_count BIGINT,
    avg_confidence NUMERIC,
    layer_score INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    WITH layer_stats AS (
        SELECT
            bk.layer,
            COUNT(*) AS fact_count,
            AVG(bk.confidence) AS avg_confidence
        FROM business_knowledge bk
        WHERE bk.organization_id = p_org_id
          AND bk.status = 'active'
        GROUP BY bk.layer
    ),
    all_layers AS (
        SELECT unnest(ARRAY['operational','customer','financial','market','growth','regulatory']) AS layer
    )
    SELECT
        al.layer,
        COALESCE(ls.fact_count, 0) AS fact_count,
        COALESCE(ls.avg_confidence, 0) AS avg_confidence,
        -- Score: 0-100 per layer. 5+ facts at high confidence = 100
        LEAST(100, (
            COALESCE(ls.fact_count, 0) * 20 *
            GREATEST(COALESCE(ls.avg_confidence, 0), 0.5)
        )::INTEGER) AS layer_score
    FROM all_layers al
    LEFT JOIN layer_stats ls ON ls.layer = al.layer
    ORDER BY al.layer;
$$;

GRANT EXECUTE ON FUNCTION get_knowledge_score(UUID) TO authenticated;
