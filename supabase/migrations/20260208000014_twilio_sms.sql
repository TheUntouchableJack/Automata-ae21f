-- Twilio SMS Integration
-- Expands event types to support SMS delivery status tracking

-- ============================================================================
-- 1. EXPAND EVENT TYPES FOR SMS
-- ============================================================================

-- Drop existing constraint and add SMS-specific event types
ALTER TABLE message_events
DROP CONSTRAINT IF EXISTS message_events_event_type_check;

ALTER TABLE message_events
ADD CONSTRAINT message_events_event_type_check
CHECK (event_type IN (
    -- Email events (existing)
    'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed',
    -- SMS events (new)
    'sent', 'queued', 'failed', 'undelivered'
));

-- ============================================================================
-- 2. PROCESS SMS EVENT RPC
-- ============================================================================
-- Wrapper that normalizes SMS events to use existing process_email_event logic

CREATE OR REPLACE FUNCTION process_sms_event(
    p_message_sid TEXT,      -- Twilio MessageSid
    p_status TEXT,           -- Twilio MessageStatus
    p_error_code TEXT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
    p_occurred_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_event_type TEXT;
    v_event_data JSONB := '{}'::JSONB;
BEGIN
    -- Map Twilio status to internal event type
    v_event_type := CASE p_status
        WHEN 'queued' THEN 'queued'
        WHEN 'sent' THEN 'sent'
        WHEN 'delivered' THEN 'delivered'
        WHEN 'failed' THEN 'bounced'      -- Map to bounced for consistency
        WHEN 'undelivered' THEN 'bounced' -- Map to bounced for consistency
        WHEN 'read' THEN 'opened'         -- Map to opened for consistency
        ELSE NULL
    END;

    IF v_event_type IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Unknown SMS status: ' || p_status
        );
    END IF;

    -- Build event data with error info if present
    IF p_error_code IS NOT NULL THEN
        v_event_data := jsonb_build_object(
            'error_code', p_error_code,
            'error_message', p_error_message,
            'original_status', p_status
        );
    ELSIF p_status IN ('failed', 'undelivered') THEN
        v_event_data := jsonb_build_object(
            'original_status', p_status,
            'reason', 'SMS delivery failed'
        );
    END IF;

    -- Use existing process_email_event (works for any channel)
    RETURN process_email_event(
        p_message_sid,
        v_event_type,
        CASE WHEN v_event_data = '{}'::JSONB THEN NULL ELSE v_event_data END,
        p_occurred_at
    );
END;
$$;

-- ============================================================================
-- 3. COMMENTS
-- ============================================================================

COMMENT ON FUNCTION process_sms_event IS 'Processes Twilio SMS delivery status webhooks, mapping to internal event types';
