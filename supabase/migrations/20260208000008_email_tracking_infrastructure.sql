-- Phase 0: Email Event Tracking Infrastructure
-- Enables tracking of email opens, clicks, bounces, and unsubscribes from Resend webhooks

-- ============================================================================
-- 1. MESSAGE RECIPIENTS - Track individual message deliveries
-- ============================================================================
-- Links batch_id to member_id with the external message_id from email provider

CREATE TABLE IF NOT EXISTS message_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES app_message_batches(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES app_members(id) ON DELETE CASCADE,

    -- External tracking
    message_id TEXT,  -- From email provider (Resend)
    channel TEXT NOT NULL CHECK (channel IN ('email', 'push', 'in_app', 'sms')),

    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'stubbed')),
    error_message TEXT,

    -- Timestamps
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure one record per batch/member
    UNIQUE(batch_id, member_id)
);

-- Indexes for fast lookups
CREATE INDEX idx_message_recipients_message_id ON message_recipients(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX idx_message_recipients_batch ON message_recipients(batch_id);
CREATE INDEX idx_message_recipients_member ON message_recipients(member_id);

-- ============================================================================
-- 2. MESSAGE EVENTS - Track engagement events (opens, clicks, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS message_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to recipient (which links to batch and member)
    recipient_id UUID REFERENCES message_recipients(id) ON DELETE CASCADE,

    -- Denormalized for faster queries (avoid joins)
    batch_id UUID REFERENCES app_message_batches(id) ON DELETE CASCADE,
    member_id UUID REFERENCES app_members(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,

    -- Event details
    event_type TEXT NOT NULL CHECK (event_type IN ('delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed')),
    event_data JSONB,  -- Click URL, bounce reason, etc.

    -- Timestamp
    occurred_at TIMESTAMPTZ DEFAULT NOW(),

    -- Prevent duplicate events (same message + event type)
    UNIQUE(message_id, event_type)
);

-- Indexes
CREATE INDEX idx_message_events_message_id ON message_events(message_id);
CREATE INDEX idx_message_events_batch ON message_events(batch_id);
CREATE INDEX idx_message_events_type ON message_events(event_type);
CREATE INDEX idx_message_events_occurred ON message_events(occurred_at DESC);

-- ============================================================================
-- 3. RPC FUNCTION - Process webhook event and update counters
-- ============================================================================

CREATE OR REPLACE FUNCTION process_email_event(
    p_message_id TEXT,
    p_event_type TEXT,
    p_event_data JSONB DEFAULT NULL,
    p_occurred_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_recipient message_recipients%ROWTYPE;
    v_event_id UUID;
    v_column_name TEXT;
BEGIN
    -- Find the recipient by message_id
    SELECT * INTO v_recipient
    FROM message_recipients
    WHERE message_id = p_message_id
    LIMIT 1;

    IF v_recipient.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Message ID not found',
            'message_id', p_message_id
        );
    END IF;

    -- Insert event (ON CONFLICT handles duplicates)
    INSERT INTO message_events (
        recipient_id,
        batch_id,
        member_id,
        message_id,
        event_type,
        event_data,
        occurred_at
    )
    VALUES (
        v_recipient.id,
        v_recipient.batch_id,
        v_recipient.member_id,
        p_message_id,
        p_event_type,
        p_event_data,
        p_occurred_at
    )
    ON CONFLICT (message_id, event_type) DO NOTHING
    RETURNING id INTO v_event_id;

    -- If event was a duplicate, return early
    IF v_event_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'message_id', p_message_id,
            'event_type', p_event_type
        );
    END IF;

    -- Map event type to batch column
    v_column_name := CASE p_event_type
        WHEN 'delivered' THEN 'delivered'
        WHEN 'opened' THEN 'opened'
        WHEN 'clicked' THEN 'clicked'
        WHEN 'bounced' THEN 'bounced'
        WHEN 'unsubscribed' THEN 'unsubscribed'
        ELSE NULL
    END;

    -- Update batch counter if applicable
    IF v_column_name IS NOT NULL THEN
        EXECUTE format(
            'UPDATE app_message_batches SET %I = COALESCE(%I, 0) + 1 WHERE id = $1',
            v_column_name,
            v_column_name
        ) USING v_recipient.batch_id;
    END IF;

    -- Update recipient status for delivered/bounced
    IF p_event_type = 'delivered' THEN
        UPDATE message_recipients
        SET status = 'delivered', delivered_at = p_occurred_at
        WHERE id = v_recipient.id;
    ELSIF p_event_type = 'bounced' THEN
        UPDATE message_recipients
        SET status = 'failed', error_message = p_event_data->>'reason'
        WHERE id = v_recipient.id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'event_id', v_event_id,
        'batch_id', v_recipient.batch_id,
        'member_id', v_recipient.member_id,
        'event_type', p_event_type
    );
END;
$$;

-- ============================================================================
-- 4. RLS POLICIES
-- ============================================================================

ALTER TABLE message_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_events ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (for edge functions)
CREATE POLICY "Service role full access on message_recipients"
    ON message_recipients FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access on message_events"
    ON message_events FOR ALL
    USING (true)
    WITH CHECK (true);

-- Organization members can read their org's data
CREATE POLICY "Org members can read message_recipients"
    ON message_recipients FOR SELECT
    USING (
        batch_id IN (
            SELECT amb.id FROM app_message_batches amb
            JOIN organization_members om ON om.organization_id = amb.organization_id
            WHERE om.user_id = auth.uid()
        )
    );

CREATE POLICY "Org members can read message_events"
    ON message_events FOR SELECT
    USING (
        batch_id IN (
            SELECT amb.id FROM app_message_batches amb
            JOIN organization_members om ON om.organization_id = amb.organization_id
            WHERE om.user_id = auth.uid()
        )
    );

-- ============================================================================
-- 5. COMMENTS
-- ============================================================================

COMMENT ON TABLE message_recipients IS 'Tracks individual message deliveries with external provider message_id';
COMMENT ON TABLE message_events IS 'Tracks email engagement events from webhooks (opens, clicks, bounces)';
COMMENT ON FUNCTION process_email_event IS 'Processes incoming webhook events, updates counters and recipient status';
