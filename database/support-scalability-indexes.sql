-- =====================================================
-- SUPPORT SYSTEM SCALABILITY INDEXES
-- Run after support-system-migration.sql
-- Optimizes queries for scale (10k+ tickets)
-- =====================================================

-- Index for organization-level dashboard queries
-- Optimizes: loadStats() and ticket listing with status filtering
CREATE INDEX IF NOT EXISTS idx_support_tickets_org_status_created
ON support_tickets(organization_id, status, created_at DESC);

-- Index for app-level filtering with escalation
-- Optimizes: Escalated tickets filter, app-specific views
CREATE INDEX IF NOT EXISTS idx_support_tickets_app_escalated
ON support_tickets(app_id, requires_human, status, updated_at DESC)
WHERE requires_human = true;

-- Index for member support history
-- Optimizes: Loading a member's ticket history
CREATE INDEX IF NOT EXISTS idx_support_tickets_member_created
ON support_tickets(member_id, created_at DESC)
WHERE member_id IS NOT NULL;

-- Index for AI session lookup by member
-- Optimizes: Finding active sessions for a member
CREATE INDEX IF NOT EXISTS idx_ai_sessions_member_status
ON ai_support_sessions(member_id, status, last_message_at DESC);

-- Index for AI message retrieval by session (most recent first)
-- Optimizes: Loading conversation history
CREATE INDEX IF NOT EXISTS idx_ai_messages_session_created
ON ai_support_messages(session_id, created_at DESC);

-- Index for FAQ lookup by app
-- Optimizes: Loading FAQs for AI context
CREATE INDEX IF NOT EXISTS idx_faq_items_app_active_order
ON faq_items(app_id, is_active, display_order)
WHERE is_active = true;

-- Index for KB article lookup
-- Optimizes: Loading articles for AI context
CREATE INDEX IF NOT EXISTS idx_kb_articles_app_published
ON knowledgebase_articles(app_id, is_published, is_featured DESC, display_order)
WHERE is_published = true;

-- Index for ticket message thread
-- Optimizes: Loading conversation thread for a ticket
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_created
ON ticket_messages(ticket_id, created_at);

-- Composite index for support settings lookup
-- Optimizes: Quick settings retrieval by app
CREATE INDEX IF NOT EXISTS idx_support_settings_app
ON support_settings(app_id);

-- =====================================================
-- ANALYZE tables to update statistics
-- =====================================================
ANALYZE support_tickets;
ANALYZE ticket_messages;
ANALYZE ai_support_sessions;
ANALYZE ai_support_messages;
ANALYZE faq_items;
ANALYZE knowledgebase_articles;
ANALYZE support_settings;

-- =====================================================
-- Note: These indexes improve query performance for:
-- 1. Dashboard stats aggregation (organization-level)
-- 2. Ticket list filtering by status/priority
-- 3. AI context loading (FAQs, KB articles)
-- 4. Conversation history retrieval
-- 5. Member support history lookup
--
-- Monitor with: EXPLAIN ANALYZE on slow queries
-- =====================================================
