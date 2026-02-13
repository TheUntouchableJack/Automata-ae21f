-- Proposal Visitor Intelligence: Identity Gate + Section Analytics
-- Tables: access_codes, visitors, visits, section_views
-- RPCs: register, start/end visit, log sections, analytics, set code

-- ============================================================================
-- 1. Access Codes (per-proposal)
-- ============================================================================
CREATE TABLE IF NOT EXISTS proposal_access_codes (
    proposal_id TEXT PRIMARY KEY,
    access_code TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE proposal_access_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read access codes" ON proposal_access_codes FOR SELECT USING (true);
CREATE POLICY "Anyone can insert access codes" ON proposal_access_codes FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update access codes" ON proposal_access_codes FOR UPDATE USING (true);

-- ============================================================================
-- 2. Visitors (unique per email per proposal)
-- ============================================================================
CREATE TABLE IF NOT EXISTS proposal_visitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    session_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(proposal_id, email)
);

ALTER TABLE proposal_visitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read visitors" ON proposal_visitors FOR SELECT USING (true);
CREATE POLICY "Anyone can insert visitors" ON proposal_visitors FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update visitors" ON proposal_visitors FOR UPDATE USING (true);

CREATE INDEX IF NOT EXISTS idx_proposal_visitors_proposal ON proposal_visitors(proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_visitors_email ON proposal_visitors(email);

-- ============================================================================
-- 3. Visits (each page session)
-- ============================================================================
CREATE TABLE IF NOT EXISTS proposal_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id UUID NOT NULL REFERENCES proposal_visitors(id) ON DELETE CASCADE,
    proposal_id TEXT NOT NULL,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    user_agent TEXT
);

ALTER TABLE proposal_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read visits" ON proposal_visits FOR SELECT USING (true);
CREATE POLICY "Anyone can insert visits" ON proposal_visits FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update visits" ON proposal_visits FOR UPDATE USING (true);

CREATE INDEX IF NOT EXISTS idx_proposal_visits_visitor ON proposal_visits(visitor_id);
CREATE INDEX IF NOT EXISTS idx_proposal_visits_proposal ON proposal_visits(proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_visits_started ON proposal_visits(started_at DESC);

-- ============================================================================
-- 4. Section Views (time spent per section per visit)
-- ============================================================================
CREATE TABLE IF NOT EXISTS proposal_section_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID NOT NULL REFERENCES proposal_visits(id) ON DELETE CASCADE,
    section_id TEXT NOT NULL,
    section_label TEXT NOT NULL,
    entered_at TIMESTAMPTZ,
    duration_seconds INTEGER DEFAULT 0,
    view_order INTEGER DEFAULT 0
);

ALTER TABLE proposal_section_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read section views" ON proposal_section_views FOR SELECT USING (true);
CREATE POLICY "Anyone can insert section views" ON proposal_section_views FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_section_views_visit ON proposal_section_views(visit_id);

-- ============================================================================
-- RPC: Register visitor (verify code + create/return visitor)
-- ============================================================================
CREATE OR REPLACE FUNCTION register_proposal_visitor(
    p_proposal_id TEXT,
    p_first_name TEXT,
    p_last_name TEXT,
    p_email TEXT,
    p_access_code TEXT,
    p_session_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_stored_code TEXT;
    v_visitor_id UUID;
BEGIN
    -- Check access code
    SELECT access_code INTO v_stored_code
    FROM proposal_access_codes
    WHERE proposal_id = p_proposal_id;

    -- If a code exists for this proposal, verify it
    IF v_stored_code IS NOT NULL AND v_stored_code != p_access_code THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid access code');
    END IF;

    -- Upsert visitor (same email on same proposal = same visitor)
    INSERT INTO proposal_visitors (proposal_id, first_name, last_name, email, session_id)
    VALUES (p_proposal_id, p_first_name, p_last_name, p_email, p_session_id)
    ON CONFLICT (proposal_id, email) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        session_id = EXCLUDED.session_id
    RETURNING id INTO v_visitor_id;

    RETURN jsonb_build_object('success', true, 'visitor_id', v_visitor_id);
END;
$$;

GRANT EXECUTE ON FUNCTION register_proposal_visitor TO anon;

-- ============================================================================
-- RPC: Start a visit
-- ============================================================================
CREATE OR REPLACE FUNCTION start_proposal_visit(
    p_visitor_id UUID,
    p_proposal_id TEXT,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_visit_id UUID;
BEGIN
    INSERT INTO proposal_visits (visitor_id, proposal_id, user_agent)
    VALUES (p_visitor_id, p_proposal_id, p_user_agent)
    RETURNING id INTO v_visit_id;

    RETURN jsonb_build_object('success', true, 'visit_id', v_visit_id);
END;
$$;

GRANT EXECUTE ON FUNCTION start_proposal_visit TO anon;

-- ============================================================================
-- RPC: Log section views (batch insert)
-- ============================================================================
CREATE OR REPLACE FUNCTION log_section_views(
    p_visit_id UUID,
    p_views JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_view JSONB;
    v_count INTEGER := 0;
BEGIN
    FOR v_view IN SELECT * FROM jsonb_array_elements(p_views)
    LOOP
        INSERT INTO proposal_section_views (
            visit_id, section_id, section_label, entered_at, duration_seconds, view_order
        ) VALUES (
            p_visit_id,
            v_view->>'section_id',
            v_view->>'section_label',
            (v_view->>'entered_at')::TIMESTAMPTZ,
            COALESCE((v_view->>'duration_seconds')::INTEGER, 0),
            COALESCE((v_view->>'view_order')::INTEGER, 0)
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'logged', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION log_section_views TO anon;

-- ============================================================================
-- RPC: End a visit
-- ============================================================================
CREATE OR REPLACE FUNCTION end_proposal_visit(
    p_visit_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE proposal_visits
    SET ended_at = NOW(),
        duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
    WHERE id = p_visit_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Visit not found');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION end_proposal_visit TO anon;

-- ============================================================================
-- RPC: Get analytics (admin-key protected)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_proposal_analytics(
    p_proposal_id TEXT,
    p_admin_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_visitors JSONB;
    v_visits JSONB;
    v_section_summary JSONB;
BEGIN
    IF p_admin_key != '24hd-jay-admin-2026' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid admin key');
    END IF;

    -- All visitors for this proposal
    SELECT COALESCE(jsonb_agg(row_to_json(v)::JSONB ORDER BY v.created_at DESC), '[]'::JSONB)
    INTO v_visitors
    FROM (
        SELECT pv.id, pv.first_name, pv.last_name, pv.email, pv.created_at,
               COUNT(pvs.id) AS total_visits,
               MAX(pvs.started_at) AS last_visit
        FROM proposal_visitors pv
        LEFT JOIN proposal_visits pvs ON pvs.visitor_id = pv.id
        WHERE pv.proposal_id = p_proposal_id
        GROUP BY pv.id
    ) v;

    -- Recent visits with section views
    SELECT COALESCE(jsonb_agg(row_to_json(vis)::JSONB ORDER BY vis.started_at DESC), '[]'::JSONB)
    INTO v_visits
    FROM (
        SELECT pvs.id, pvs.visitor_id, pvs.started_at, pvs.ended_at, pvs.duration_seconds,
               pvs.user_agent,
               pv.first_name, pv.last_name, pv.email,
               COALESCE((
                   SELECT jsonb_agg(row_to_json(sv)::JSONB ORDER BY sv.view_order)
                   FROM proposal_section_views sv
                   WHERE sv.visit_id = pvs.id
               ), '[]'::JSONB) AS sections
        FROM proposal_visits pvs
        JOIN proposal_visitors pv ON pv.id = pvs.visitor_id
        WHERE pvs.proposal_id = p_proposal_id
        ORDER BY pvs.started_at DESC
        LIMIT 50
    ) vis;

    -- Section summary (total time per section across all visits)
    SELECT COALESCE(jsonb_agg(row_to_json(ss)::JSONB ORDER BY ss.total_seconds DESC), '[]'::JSONB)
    INTO v_section_summary
    FROM (
        SELECT sv.section_id, sv.section_label,
               SUM(sv.duration_seconds) AS total_seconds,
               COUNT(*) AS view_count,
               ROUND(AVG(sv.duration_seconds)) AS avg_seconds
        FROM proposal_section_views sv
        JOIN proposal_visits pvs ON pvs.id = sv.visit_id
        WHERE pvs.proposal_id = p_proposal_id
        GROUP BY sv.section_id, sv.section_label
    ) ss;

    RETURN jsonb_build_object(
        'success', true,
        'visitors', v_visitors,
        'visits', v_visits,
        'section_summary', v_section_summary
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_proposal_analytics TO anon;

-- ============================================================================
-- RPC: Set access code (admin-key protected)
-- ============================================================================
CREATE OR REPLACE FUNCTION set_proposal_access_code(
    p_proposal_id TEXT,
    p_access_code TEXT,
    p_admin_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_admin_key != '24hd-jay-admin-2026' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid admin key');
    END IF;

    INSERT INTO proposal_access_codes (proposal_id, access_code)
    VALUES (p_proposal_id, p_access_code)
    ON CONFLICT (proposal_id) DO UPDATE SET
        access_code = EXCLUDED.access_code;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION set_proposal_access_code TO anon;
