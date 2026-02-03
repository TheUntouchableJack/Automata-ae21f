-- =====================================================
-- CUSTOMER TICKET ACCESS
-- Allows customers to view and reply to their own tickets
-- Run after support-system-migration.sql
-- =====================================================

-- =====================================================
-- 1. GET CUSTOMER'S TICKETS
-- =====================================================

CREATE OR REPLACE FUNCTION get_my_tickets(
    p_member_id UUID,
    p_app_id UUID
)
RETURNS TABLE (
    id UUID,
    ticket_number TEXT,
    subject TEXT,
    status TEXT,
    priority TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    last_message_at TIMESTAMPTZ,
    unread_count BIGINT,
    last_message_preview TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.ticket_number,
        t.subject,
        t.status,
        t.priority,
        t.created_at,
        t.updated_at,
        (SELECT MAX(tm.created_at) FROM ticket_messages tm WHERE tm.ticket_id = t.id) as last_message_at,
        (
            SELECT COUNT(*)::BIGINT
            FROM ticket_messages tm
            WHERE tm.ticket_id = t.id
              AND tm.sender_type IN ('staff', 'ai')
              AND tm.created_at > COALESCE(t.customer_last_read_at, t.created_at)
        ) as unread_count,
        (
            SELECT LEFT(tm.message, 100)
            FROM ticket_messages tm
            WHERE tm.ticket_id = t.id
            ORDER BY tm.created_at DESC
            LIMIT 1
        ) as last_message_preview
    FROM support_tickets t
    WHERE t.member_id = p_member_id
      AND t.app_id = p_app_id
    ORDER BY t.updated_at DESC
    LIMIT 50;
END;
$$;

-- Grant execute to anonymous (customer app uses anon key)
GRANT EXECUTE ON FUNCTION get_my_tickets(UUID, UUID) TO anon, authenticated;

-- =====================================================
-- 2. GET TICKET MESSAGES (for customer view)
-- =====================================================

CREATE OR REPLACE FUNCTION get_ticket_messages_for_customer(
    p_ticket_id UUID,
    p_member_id UUID
)
RETURNS TABLE (
    id UUID,
    sender_type TEXT,
    sender_name TEXT,
    message TEXT,
    created_at TIMESTAMPTZ,
    is_from_me BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_ticket_exists BOOLEAN;
BEGIN
    -- Verify ticket belongs to this member
    SELECT EXISTS (
        SELECT 1 FROM support_tickets
        WHERE id = p_ticket_id AND member_id = p_member_id
    ) INTO v_ticket_exists;

    IF NOT v_ticket_exists THEN
        RAISE EXCEPTION 'Ticket not found or access denied';
    END IF;

    -- Update last read timestamp
    UPDATE support_tickets
    SET customer_last_read_at = NOW()
    WHERE id = p_ticket_id;

    -- Return messages (exclude internal notes)
    RETURN QUERY
    SELECT
        tm.id,
        tm.sender_type,
        COALESCE(tm.sender_name,
            CASE tm.sender_type
                WHEN 'staff' THEN 'Support Team'
                WHEN 'ai' THEN 'Support'
                WHEN 'customer' THEN 'You'
                ELSE 'System'
            END
        ) as sender_name,
        tm.message,
        tm.created_at,
        (tm.sender_type = 'customer') as is_from_me
    FROM ticket_messages tm
    WHERE tm.ticket_id = p_ticket_id
      AND tm.is_internal = false
    ORDER BY tm.created_at ASC
    LIMIT 100;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ticket_messages_for_customer(UUID, UUID) TO anon, authenticated;

-- =====================================================
-- 3. CUSTOMER REPLY TO TICKET
-- =====================================================

CREATE OR REPLACE FUNCTION customer_reply_to_ticket(
    p_ticket_id UUID,
    p_member_id UUID,
    p_message TEXT
)
RETURNS TABLE (
    success BOOLEAN,
    message_id UUID,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_ticket RECORD;
    v_member RECORD;
    v_message_id UUID;
BEGIN
    -- Validate message
    IF p_message IS NULL OR LENGTH(TRIM(p_message)) = 0 THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Message cannot be empty'::TEXT;
        RETURN;
    END IF;

    IF LENGTH(p_message) > 5000 THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Message too long (max 5000 characters)'::TEXT;
        RETURN;
    END IF;

    -- Get ticket and verify ownership
    SELECT * INTO v_ticket
    FROM support_tickets
    WHERE id = p_ticket_id AND member_id = p_member_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Ticket not found or access denied'::TEXT;
        RETURN;
    END IF;

    -- Get member info for sender name
    SELECT first_name, last_name INTO v_member
    FROM app_members
    WHERE id = p_member_id;

    -- Insert message
    INSERT INTO ticket_messages (
        ticket_id,
        sender_type,
        sender_id,
        sender_name,
        message
    ) VALUES (
        p_ticket_id,
        'customer',
        p_member_id,
        COALESCE(v_member.first_name || ' ' || v_member.last_name, 'Customer'),
        TRIM(p_message)
    )
    RETURNING id INTO v_message_id;

    -- Update ticket status to awaiting response if it was pending customer
    UPDATE support_tickets
    SET
        status = CASE
            WHEN status = 'pending_customer' THEN 'awaiting_response'
            WHEN status IN ('resolved', 'closed') THEN 'open'
            ELSE status
        END,
        updated_at = NOW()
    WHERE id = p_ticket_id;

    RETURN QUERY SELECT true, v_message_id, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION customer_reply_to_ticket(UUID, UUID, TEXT) TO anon, authenticated;

-- =====================================================
-- 4. GET UNREAD MESSAGE COUNT
-- =====================================================

CREATE OR REPLACE FUNCTION get_customer_unread_count(
    p_member_id UUID,
    p_app_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM support_tickets t
    WHERE t.member_id = p_member_id
      AND t.app_id = p_app_id
      AND EXISTS (
          SELECT 1
          FROM ticket_messages tm
          WHERE tm.ticket_id = t.id
            AND tm.sender_type IN ('staff', 'ai')
            AND tm.created_at > COALESCE(t.customer_last_read_at, t.created_at)
      );

    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION get_customer_unread_count(UUID, UUID) TO anon, authenticated;

-- =====================================================
-- 5. GET AI CONVERSATION HISTORY FOR TICKET
-- (Shows the AI chat that led to escalation)
-- =====================================================

CREATE OR REPLACE FUNCTION get_ticket_ai_history(
    p_ticket_id UUID,
    p_member_id UUID
)
RETURNS TABLE (
    id UUID,
    role TEXT,
    content TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_session_id UUID;
BEGIN
    -- Get AI session ID from ticket metadata
    SELECT (metadata->>'ai_session_id')::UUID INTO v_session_id
    FROM support_tickets
    WHERE id = p_ticket_id AND member_id = p_member_id;

    IF v_session_id IS NULL THEN
        -- No AI history for this ticket
        RETURN;
    END IF;

    -- Return AI conversation messages
    RETURN QUERY
    SELECT
        m.id,
        m.role,
        m.content,
        m.created_at
    FROM ai_support_messages m
    WHERE m.session_id = v_session_id
    ORDER BY m.created_at ASC
    LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ticket_ai_history(UUID, UUID) TO anon, authenticated;

-- =====================================================
-- 6. ADD customer_last_read_at COLUMN IF NOT EXISTS
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'support_tickets'
        AND column_name = 'customer_last_read_at'
    ) THEN
        ALTER TABLE support_tickets
        ADD COLUMN customer_last_read_at TIMESTAMPTZ;

        COMMENT ON COLUMN support_tickets.customer_last_read_at IS 'When customer last viewed the ticket messages';
    END IF;
END $$;

-- =====================================================
-- 7. CREATE TICKET FROM AI CHAT (improved version)
-- =====================================================

CREATE OR REPLACE FUNCTION create_ticket_from_ai_chat(
    p_app_id UUID,
    p_member_id UUID,
    p_session_id UUID,
    p_subject TEXT,
    p_description TEXT,
    p_escalation_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    ticket_id UUID,
    ticket_number TEXT,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org_id UUID;
    v_ticket_number TEXT;
    v_ticket_id UUID;
BEGIN
    -- Get organization from app
    SELECT organization_id INTO v_org_id
    FROM customer_apps
    WHERE id = p_app_id;

    IF v_org_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'App not found'::TEXT;
        RETURN;
    END IF;

    -- Generate ticket number
    SELECT generate_ticket_number(p_app_id) INTO v_ticket_number;

    -- Create ticket
    INSERT INTO support_tickets (
        app_id,
        organization_id,
        member_id,
        ticket_number,
        subject,
        description,
        ticket_type,
        priority,
        status,
        requires_human,
        escalation_reason,
        source,
        metadata
    ) VALUES (
        p_app_id,
        v_org_id,
        p_member_id,
        v_ticket_number,
        p_subject,
        p_description,
        'question',
        CASE
            WHEN p_escalation_reason IN ('escalation_keyword', 'requires_human_action') THEN 'high'
            ELSE 'normal'
        END,
        'escalated',
        true,
        p_escalation_reason,
        'ai_support',
        jsonb_build_object('ai_session_id', p_session_id)
    )
    RETURNING id INTO v_ticket_id;

    RETURN QUERY SELECT true, v_ticket_id, v_ticket_number, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION create_ticket_from_ai_chat(UUID, UUID, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;

-- =====================================================
-- DONE
-- =====================================================
SELECT 'Customer ticket access migration complete' as status;
