-- Message Events Table Partitioning
-- Converts message_events to monthly range partitions on occurred_at
-- At scale (150M rows/month), this enables fast partition drops vs row-by-row DELETE
-- Safe to run pre-launch when table has few/no rows

-- ============================================================================
-- STEP 1: Rename existing table
-- ============================================================================

ALTER TABLE IF EXISTS message_events RENAME TO message_events_old;

-- Drop old indexes (they'll be recreated on the partitioned table)
DROP INDEX IF EXISTS idx_message_events_message_id;
DROP INDEX IF EXISTS idx_message_events_batch;
DROP INDEX IF EXISTS idx_message_events_type;
DROP INDEX IF EXISTS idx_message_events_occurred;

-- ============================================================================
-- STEP 2: Create partitioned table
-- Note: UNIQUE constraints on partitioned tables must include the partition key
-- ============================================================================

CREATE TABLE message_events (
    id UUID DEFAULT gen_random_uuid(),
    recipient_id UUID REFERENCES message_recipients(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES app_message_batches(id) ON DELETE CASCADE,
    member_id UUID REFERENCES app_members(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed',
        'sent', 'delivery_delayed', 'failed'
    )),
    event_data JSONB,
    occurred_at TIMESTAMPTZ DEFAULT NOW(),

    -- Partition key must be part of any UNIQUE constraint
    UNIQUE(message_id, event_type, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- ============================================================================
-- STEP 3: Create monthly partitions (Feb 2026 through Dec 2026)
-- ============================================================================

CREATE TABLE message_events_2026_02 PARTITION OF message_events
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE message_events_2026_03 PARTITION OF message_events
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE message_events_2026_04 PARTITION OF message_events
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE message_events_2026_05 PARTITION OF message_events
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE message_events_2026_06 PARTITION OF message_events
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE message_events_2026_07 PARTITION OF message_events
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE message_events_2026_08 PARTITION OF message_events
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE message_events_2026_09 PARTITION OF message_events
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE message_events_2026_10 PARTITION OF message_events
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE message_events_2026_11 PARTITION OF message_events
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE message_events_2026_12 PARTITION OF message_events
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- Default partition catches anything outside defined ranges
CREATE TABLE message_events_default PARTITION OF message_events DEFAULT;

-- ============================================================================
-- STEP 4: Recreate indexes on partitioned table
-- (PostgreSQL auto-creates per-partition indexes)
-- ============================================================================

CREATE INDEX idx_message_events_message_id ON message_events(message_id);
CREATE INDEX idx_message_events_batch ON message_events(batch_id);
CREATE INDEX idx_message_events_type ON message_events(event_type);
CREATE INDEX idx_message_events_occurred ON message_events(occurred_at DESC);
CREATE INDEX idx_message_events_member ON message_events(member_id, occurred_at DESC);

-- ============================================================================
-- STEP 5: Migrate existing data (if any)
-- ============================================================================

INSERT INTO message_events (id, recipient_id, batch_id, member_id, message_id, event_type, event_data, occurred_at)
SELECT id, recipient_id, batch_id, member_id, message_id, event_type, event_data, occurred_at
FROM message_events_old
ON CONFLICT DO NOTHING;

-- ============================================================================
-- STEP 6: RLS on new table
-- ============================================================================

ALTER TABLE message_events ENABLE ROW LEVEL SECURITY;

-- Org members can view events for their org's messages
CREATE POLICY "Org members can view message events" ON message_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_message_batches b
            JOIN organization_members om ON om.organization_id = b.organization_id
            WHERE b.id = message_events.batch_id
            AND om.user_id = auth.uid()
        )
    );

-- Service role can insert (webhooks)
-- No explicit INSERT policy needed - service role bypasses RLS

-- ============================================================================
-- STEP 7: Auto-create partitions function
-- Run via cron on the 25th of each month
-- ============================================================================

CREATE OR REPLACE FUNCTION create_next_month_partition()
RETURNS VOID AS $$
DECLARE
    v_next_month DATE;
    v_month_after DATE;
    v_partition_name TEXT;
BEGIN
    v_next_month := DATE_TRUNC('month', NOW()) + INTERVAL '1 month';
    v_month_after := v_next_month + INTERVAL '1 month';
    v_partition_name := 'message_events_' || TO_CHAR(v_next_month, 'YYYY_MM');

    -- Only create if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_class WHERE relname = v_partition_name
    ) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF message_events FOR VALUES FROM (%L) TO (%L)',
            v_partition_name, v_next_month, v_month_after
        );
        RAISE NOTICE 'Created partition: %', v_partition_name;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule auto-partition creation: 25th of each month at 2 AM UTC
SELECT cron.schedule(
    'create-message-events-partition',
    '0 2 25 * *',
    $$SELECT create_next_month_partition()$$
);

-- ============================================================================
-- STEP 8: Drop old table (only after confirming data migrated)
-- ============================================================================

DROP TABLE IF EXISTS message_events_old;
