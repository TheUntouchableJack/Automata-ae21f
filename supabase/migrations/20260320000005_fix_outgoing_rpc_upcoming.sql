-- Fix: Always show scheduled/paused campaigns regardless of date filter
-- Add: 'upcoming' virtual status that matches both scheduled + paused

CREATE OR REPLACE FUNCTION get_outgoing_campaigns(
    p_organization_id UUID,
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
    automation_enabled BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
        ad.is_enabled AS automation_enabled
    FROM app_message_batches b
    LEFT JOIN automation_definitions ad ON ad.id = b.automation_id
    WHERE b.organization_id = p_organization_id
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
