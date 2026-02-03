-- =====================================================
-- ESCALATION NOTIFICATIONS SYSTEM
-- Run after support-system-migration.sql
-- Creates in-dashboard notifications and webhook triggers
-- =====================================================

-- =====================================================
-- 1. OWNER_NOTIFICATIONS TABLE
-- In-dashboard notifications for business owners
-- =====================================================

CREATE TABLE IF NOT EXISTS owner_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- What triggered the notification
    notification_type TEXT NOT NULL,  -- 'escalation', 'new_ticket', 'ticket_reply', 'low_satisfaction'

    -- Context
    title TEXT NOT NULL,
    message TEXT NOT NULL,

    -- Related entities
    ticket_id UUID REFERENCES support_tickets(id) ON DELETE CASCADE,
    session_id UUID REFERENCES ai_support_sessions(id) ON DELETE CASCADE,
    app_id UUID REFERENCES customer_apps(id) ON DELETE CASCADE,
    member_id UUID REFERENCES app_members(id) ON DELETE SET NULL,

    -- Priority for UI sorting
    priority TEXT DEFAULT 'normal',  -- 'low', 'normal', 'high', 'urgent'

    -- Metadata
    metadata JSONB DEFAULT '{}',  -- Extra context (escalation_reason, confidence, etc.)

    -- Status
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    read_by UUID REFERENCES profiles(id),

    -- Action taken
    action_taken TEXT,  -- 'viewed_ticket', 'responded', 'dismissed'
    actioned_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast dashboard queries
CREATE INDEX IF NOT EXISTS idx_owner_notifications_org_unread
    ON owner_notifications(organization_id, is_read, created_at DESC)
    WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_owner_notifications_org_created
    ON owner_notifications(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_owner_notifications_type
    ON owner_notifications(notification_type);

-- Enable RLS
ALTER TABLE owner_notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Org members can view notifications" ON owner_notifications
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = owner_notifications.organization_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Org members can update notifications" ON owner_notifications
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = owner_notifications.organization_id
            AND om.user_id = auth.uid()
        )
    );

-- System can create notifications
CREATE POLICY "System can create notifications" ON owner_notifications
    FOR INSERT WITH CHECK (true);

-- =====================================================
-- 2. NOTIFICATION FUNCTIONS
-- =====================================================

-- Create notification for escalation
CREATE OR REPLACE FUNCTION create_escalation_notification(
    p_organization_id UUID,
    p_app_id UUID,
    p_ticket_id UUID,
    p_session_id UUID,
    p_member_id UUID,
    p_escalation_reason TEXT,
    p_customer_message TEXT,
    p_confidence DECIMAL
)
RETURNS UUID AS $$
DECLARE
    v_notification_id UUID;
    v_app_name TEXT;
    v_member_name TEXT;
    v_title TEXT;
    v_message TEXT;
    v_priority TEXT;
BEGIN
    -- Get app name
    SELECT name INTO v_app_name FROM customer_apps WHERE id = p_app_id;

    -- Get member name
    SELECT first_name || ' ' || last_name INTO v_member_name
    FROM app_members WHERE id = p_member_id;

    -- Set priority based on reason
    v_priority := CASE
        WHEN p_escalation_reason = 'escalation_keyword' THEN 'high'
        WHEN p_escalation_reason = 'low_confidence' THEN 'normal'
        WHEN p_escalation_reason = 'max_turns_reached' THEN 'normal'
        WHEN p_escalation_reason = 'ai_disabled' THEN 'normal'
        ELSE 'normal'
    END;

    -- Build title
    v_title := CASE p_escalation_reason
        WHEN 'escalation_keyword' THEN '🚨 Customer requested human support'
        WHEN 'low_confidence' THEN '⚠️ AI needs help with customer question'
        WHEN 'max_turns_reached' THEN '💬 Extended conversation needs attention'
        WHEN 'ai_disabled' THEN '📩 New support request (AI disabled)'
        ELSE '📩 Support escalation'
    END;

    -- Build message
    v_message := COALESCE(v_member_name, 'A customer') || ' from ' || COALESCE(v_app_name, 'your app') ||
        ' needs assistance. ' ||
        CASE
            WHEN p_escalation_reason = 'escalation_keyword' THEN 'They specifically asked to speak with a human.'
            WHEN p_escalation_reason = 'low_confidence' THEN 'The AI wasn''t confident about the answer.'
            WHEN p_escalation_reason = 'max_turns_reached' THEN 'The conversation has been going for a while without resolution.'
            ELSE ''
        END;

    -- Create notification
    INSERT INTO owner_notifications (
        organization_id,
        notification_type,
        title,
        message,
        ticket_id,
        session_id,
        app_id,
        member_id,
        priority,
        metadata
    ) VALUES (
        p_organization_id,
        'escalation',
        v_title,
        v_message,
        p_ticket_id,
        p_session_id,
        p_app_id,
        p_member_id,
        v_priority,
        jsonb_build_object(
            'escalation_reason', p_escalation_reason,
            'customer_message', LEFT(p_customer_message, 500),
            'ai_confidence', p_confidence
        )
    )
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Send webhook notification for escalation
-- Note: Requires pg_net extension enabled in Supabase
CREATE OR REPLACE FUNCTION send_escalation_webhook(
    p_app_id UUID,
    p_ticket_id UUID,
    p_member_id UUID,
    p_escalation_reason TEXT,
    p_customer_message TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    v_webhook_url TEXT;
    v_app_name TEXT;
    v_member_name TEXT;
    v_member_email TEXT;
    v_payload JSONB;
BEGIN
    -- Get webhook URL from support settings
    SELECT notification_webhook_url INTO v_webhook_url
    FROM support_settings
    WHERE app_id = p_app_id
    AND notify_on_escalation = true
    AND notification_webhook_url IS NOT NULL
    AND notification_webhook_url != '';

    -- Exit if no webhook configured
    IF v_webhook_url IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Get context
    SELECT name INTO v_app_name FROM customer_apps WHERE id = p_app_id;
    SELECT first_name || ' ' || last_name, email
    INTO v_member_name, v_member_email
    FROM app_members WHERE id = p_member_id;

    -- Build Slack-compatible payload
    v_payload := jsonb_build_object(
        'text', '🚨 Support Escalation: ' || COALESCE(v_member_name, 'Customer') || ' needs help',
        'blocks', jsonb_build_array(
            jsonb_build_object(
                'type', 'header',
                'text', jsonb_build_object(
                    'type', 'plain_text',
                    'text', '🚨 Support Escalation',
                    'emoji', true
                )
            ),
            jsonb_build_object(
                'type', 'section',
                'fields', jsonb_build_array(
                    jsonb_build_object('type', 'mrkdwn', 'text', '*App:* ' || COALESCE(v_app_name, 'Unknown')),
                    jsonb_build_object('type', 'mrkdwn', 'text', '*Customer:* ' || COALESCE(v_member_name, 'Unknown')),
                    jsonb_build_object('type', 'mrkdwn', 'text', '*Email:* ' || COALESCE(v_member_email, 'N/A')),
                    jsonb_build_object('type', 'mrkdwn', 'text', '*Reason:* ' || REPLACE(p_escalation_reason, '_', ' '))
                )
            ),
            jsonb_build_object(
                'type', 'section',
                'text', jsonb_build_object(
                    'type', 'mrkdwn',
                    'text', '*Customer Message:*\n>' || LEFT(p_customer_message, 500)
                )
            ),
            jsonb_build_object(
                'type', 'actions',
                'elements', jsonb_build_array(
                    jsonb_build_object(
                        'type', 'button',
                        'text', jsonb_build_object('type', 'plain_text', 'text', 'View Ticket'),
                        'url', 'https://royaltyapp.ai/app/support.html?ticket=' || p_ticket_id::TEXT
                    )
                )
            )
        )
    );

    -- Send webhook using pg_net
    -- Note: This requires pg_net extension enabled
    BEGIN
        PERFORM net.http_post(
            url := v_webhook_url,
            headers := '{"Content-Type": "application/json"}'::jsonb,
            body := v_payload::text
        );
    EXCEPTION
        WHEN OTHERS THEN
            RAISE WARNING 'Failed to send escalation webhook: %', SQLERRM;
            RETURN FALSE;
    END;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Main escalation handler - creates notification and sends webhook
CREATE OR REPLACE FUNCTION handle_support_escalation(
    p_app_id UUID,
    p_organization_id UUID,
    p_ticket_id UUID,
    p_session_id UUID,
    p_member_id UUID,
    p_escalation_reason TEXT,
    p_customer_message TEXT,
    p_confidence DECIMAL DEFAULT 0.5
)
RETURNS JSONB AS $$
DECLARE
    v_notification_id UUID;
    v_webhook_sent BOOLEAN;
    v_settings RECORD;
BEGIN
    -- Get notification settings
    SELECT notify_on_escalation, notification_email, notification_webhook_url
    INTO v_settings
    FROM support_settings
    WHERE app_id = p_app_id;

    -- Default to true if no settings found
    IF v_settings IS NULL THEN
        v_settings.notify_on_escalation := true;
    END IF;

    -- Create in-dashboard notification
    IF v_settings.notify_on_escalation THEN
        v_notification_id := create_escalation_notification(
            p_organization_id,
            p_app_id,
            p_ticket_id,
            p_session_id,
            p_member_id,
            p_escalation_reason,
            p_customer_message,
            p_confidence
        );
    END IF;

    -- Send webhook notification
    v_webhook_sent := send_escalation_webhook(
        p_app_id,
        p_ticket_id,
        p_member_id,
        p_escalation_reason,
        p_customer_message
    );

    RETURN jsonb_build_object(
        'notification_created', v_notification_id IS NOT NULL,
        'notification_id', v_notification_id,
        'webhook_sent', v_webhook_sent
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 3. HELPER FUNCTIONS FOR DASHBOARD
-- =====================================================

-- Get unread notification count for organization
CREATE OR REPLACE FUNCTION get_unread_notification_count(p_organization_id UUID)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM owner_notifications
        WHERE organization_id = p_organization_id
        AND is_read = false
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Mark notification as read
CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE owner_notifications
    SET is_read = true,
        read_at = NOW(),
        read_by = auth.uid()
    WHERE id = p_notification_id
    AND EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = owner_notifications.organization_id
        AND om.user_id = auth.uid()
    );

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Mark all notifications as read for organization
CREATE OR REPLACE FUNCTION mark_all_notifications_read(p_organization_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE owner_notifications
    SET is_read = true,
        read_at = NOW(),
        read_by = auth.uid()
    WHERE organization_id = p_organization_id
    AND is_read = false
    AND EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = p_organization_id
        AND om.user_id = auth.uid()
    );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get recent notifications for organization
CREATE OR REPLACE FUNCTION get_recent_notifications(
    p_organization_id UUID,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    id UUID,
    notification_type TEXT,
    title TEXT,
    message TEXT,
    priority TEXT,
    is_read BOOLEAN,
    ticket_id UUID,
    app_id UUID,
    member_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        n.id,
        n.notification_type,
        n.title,
        n.message,
        n.priority,
        n.is_read,
        n.ticket_id,
        n.app_id,
        n.member_id,
        n.metadata,
        n.created_at
    FROM owner_notifications n
    WHERE n.organization_id = p_organization_id
    AND EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = p_organization_id
        AND om.user_id = auth.uid()
    )
    ORDER BY n.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =====================================================
-- 4. OPTIONAL: EMAIL NOTIFICATION VIA EDGE FUNCTION
-- This creates a trigger that calls an Edge Function for email
-- =====================================================

-- Create a table to queue email notifications
CREATE TABLE IF NOT EXISTS email_notification_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    template TEXT,  -- 'escalation', 'new_ticket', etc.
    template_data JSONB DEFAULT '{}',
    status TEXT DEFAULT 'pending',  -- 'pending', 'sent', 'failed'
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_queue_pending
    ON email_notification_queue(status, created_at)
    WHERE status = 'pending';

-- Function to queue escalation email
CREATE OR REPLACE FUNCTION queue_escalation_email(
    p_app_id UUID,
    p_member_id UUID,
    p_ticket_id UUID,
    p_escalation_reason TEXT,
    p_customer_message TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    v_email TEXT;
    v_app_name TEXT;
    v_member_name TEXT;
    v_subject TEXT;
    v_body TEXT;
BEGIN
    -- Get notification email from support settings
    SELECT notification_email INTO v_email
    FROM support_settings
    WHERE app_id = p_app_id
    AND notify_on_escalation = true
    AND notification_email IS NOT NULL
    AND notification_email != '';

    -- Exit if no email configured
    IF v_email IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Get context
    SELECT name INTO v_app_name FROM customer_apps WHERE id = p_app_id;
    SELECT first_name || ' ' || last_name INTO v_member_name
    FROM app_members WHERE id = p_member_id;

    -- Build email
    v_subject := '🚨 Support Escalation - ' || COALESCE(v_app_name, 'Your App');
    v_body := 'A customer needs your attention.\n\n' ||
        'Customer: ' || COALESCE(v_member_name, 'Unknown') || '\n' ||
        'Reason: ' || REPLACE(p_escalation_reason, '_', ' ') || '\n' ||
        'Message: ' || LEFT(p_customer_message, 500) || '\n\n' ||
        'View ticket: https://royaltyapp.ai/app/support.html?ticket=' || p_ticket_id::TEXT;

    -- Queue the email
    INSERT INTO email_notification_queue (to_email, subject, body, template, template_data)
    VALUES (
        v_email,
        v_subject,
        v_body,
        'escalation',
        jsonb_build_object(
            'app_name', v_app_name,
            'member_name', v_member_name,
            'escalation_reason', p_escalation_reason,
            'customer_message', LEFT(p_customer_message, 500),
            'ticket_id', p_ticket_id
        )
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 5. GRANT PERMISSIONS
-- =====================================================

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION create_escalation_notification TO service_role;
GRANT EXECUTE ON FUNCTION send_escalation_webhook TO service_role;
GRANT EXECUTE ON FUNCTION handle_support_escalation TO service_role;
GRANT EXECUTE ON FUNCTION queue_escalation_email TO service_role;
GRANT EXECUTE ON FUNCTION get_unread_notification_count TO authenticated;
GRANT EXECUTE ON FUNCTION mark_notification_read TO authenticated;
GRANT EXECUTE ON FUNCTION mark_all_notifications_read TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_notifications TO authenticated;

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '✅ Escalation notification system created successfully!';
    RAISE NOTICE '   - owner_notifications table created';
    RAISE NOTICE '   - Notification functions created';
    RAISE NOTICE '   - Email queue table created';
    RAISE NOTICE '   - Dashboard helper functions created';
END $$;
