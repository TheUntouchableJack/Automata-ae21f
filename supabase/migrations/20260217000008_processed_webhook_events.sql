-- Idempotency table for webhook event processing
-- Prevents duplicate handling of Stripe (and other provider) webhook events
CREATE TABLE IF NOT EXISTS processed_webhook_events (
    id BIGSERIAL PRIMARY KEY,
    event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pwe_event_id ON processed_webhook_events(event_id);
