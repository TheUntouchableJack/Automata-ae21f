-- Super Admin: Cross-org campaign monitoring
-- Allows is_admin users to pass NULL org_id to see all organizations' campaigns.
-- Regular users must always provide their org_id (enforced by RPC guard).

-- 1. Modify get_outgoing_campaigns to support NULL org_id (admin = all orgs)
CREATE OR REPLACE FUNCTION get_outgoing_campaigns(
    p_organization_id UUID DEFAULT NULL,
    p_channel TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_days INTEGER DEFAULT 30,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    batch_id UUID,
    channel TEXT,
    subject TEXT,
    body TEXT,
    segment TEXT,
    status TEXT,
    created_by TEXT,
    scheduled_for TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    total_recipients INTEGER,
    delivered INTEGER,
    opened INTEGER,
    clicked INTEGER,
    bounced INTEGER,
    unsubscribed INTEGER,
    automation_id UUID,
    automation_name TEXT,
    automation_category TEXT,
    automation_enabled BOOLEAN,
    org_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Admin guard: NULL org_id requires super admin
    IF p_organization_id IS NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        ) THEN
            RAISE EXCEPTION 'Unauthorized: super admin required for cross-org access';
        END IF;
    END IF;

    RETURN QUERY
    SELECT
        b.id AS batch_id,
        b.channel,
        b.subject,
        b.body,
        b.segment,
        b.status,
        b.created_by,
        b.scheduled_for,
        b.sent_at,
        b.created_at,
        b.total_recipients,
        b.delivered,
        b.opened,
        b.clicked,
        b.bounced,
        b.unsubscribed,
        ad.id AS automation_id,
        ad.name AS automation_name,
        ad.category AS automation_category,
        ad.is_enabled AS automation_enabled,
        o.name AS org_name
    FROM app_message_batches b
    LEFT JOIN automation_definitions ad ON ad.id = b.automation_id
    LEFT JOIN organizations o ON o.id = b.organization_id
    WHERE (p_organization_id IS NULL OR b.organization_id = p_organization_id)
      AND (p_channel IS NULL OR b.channel = p_channel)
      AND (
          p_status IS NULL
          OR (p_status = 'upcoming' AND b.status IN ('scheduled', 'paused'))
          OR (p_status != 'upcoming' AND b.status = p_status)
      )
      AND (
          b.created_at >= NOW() - (p_days || ' days')::INTERVAL
          OR b.status IN ('scheduled', 'paused')
      )
    ORDER BY
        CASE b.status
            WHEN 'sending' THEN 1
            WHEN 'scheduled' THEN 2
            WHEN 'paused' THEN 3
            WHEN 'draft' THEN 4
            WHEN 'sent' THEN 5
            WHEN 'partially_sent' THEN 6
            WHEN 'failed' THEN 7
            WHEN 'cancelled' THEN 8
        END,
        b.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- 2. Modify get_outgoing_summary to support NULL org_id
CREATE OR REPLACE FUNCTION get_outgoing_summary(
    p_organization_id UUID DEFAULT NULL,
    p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    total_sent BIGINT,
    total_delivered BIGINT,
    total_opened BIGINT,
    total_clicked BIGINT,
    total_bounced BIGINT,
    total_batches BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Admin guard: NULL org_id requires super admin
    IF p_organization_id IS NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        ) THEN
            RAISE EXCEPTION 'Unauthorized: super admin required for cross-org access';
        END IF;
    END IF;

    RETURN QUERY
    SELECT
        COALESCE(SUM(b.total_recipients), 0)::BIGINT AS total_sent,
        COALESCE(SUM(b.delivered), 0)::BIGINT AS total_delivered,
        COALESCE(SUM(b.opened), 0)::BIGINT AS total_opened,
        COALESCE(SUM(b.clicked), 0)::BIGINT AS total_clicked,
        COALESCE(SUM(b.bounced), 0)::BIGINT AS total_bounced,
        COUNT(*)::BIGINT AS total_batches
    FROM app_message_batches b
    WHERE (p_organization_id IS NULL OR b.organization_id = p_organization_id)
      AND b.status IN ('sent', 'partially_sent', 'sending')
      AND b.created_at >= NOW() - (p_days || ' days')::INTERVAL;
END;
$$;

-- 3. Helper RPC: get all organization names (admin only)
CREATE OR REPLACE FUNCTION get_all_organization_names()
RETURNS TABLE (id UUID, name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    ) THEN
        RAISE EXCEPTION 'Unauthorized: super admin required';
    END IF;

    RETURN QUERY
    SELECT o.id, o.name
    FROM organizations o
    ORDER BY o.name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_all_organization_names TO authenticated;
