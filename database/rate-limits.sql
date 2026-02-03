-- =====================================================
-- RATE LIMITS TABLE
-- Copy and paste this entire file into Supabase SQL Editor
-- =====================================================

-- RATE LIMITS TABLE (Track request rates)
CREATE TABLE IF NOT EXISTS rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL, -- IP address, user_id, or session_id
    action_type TEXT NOT NULL, -- 'feature_request', 'waitlist', 'ai_analysis', 'business_analysis', 'vote'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
    ON rate_limits(identifier, action_type, created_at DESC);

-- Allow inserts for tracking
CREATE POLICY "Anyone can insert rate limit records" ON rate_limits
    FOR INSERT WITH CHECK (true);

-- Allow reads for checking limits
CREATE POLICY "Anyone can view rate limits" ON rate_limits
    FOR SELECT USING (true);

-- Cleanup old records (older than 24 hours)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void AS $$
BEGIN
    DELETE FROM rate_limits WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if action is rate limited
-- Returns TRUE if rate limited (too many requests), FALSE if allowed
CREATE OR REPLACE FUNCTION check_rate_limit(
    p_identifier TEXT,
    p_action_type TEXT,
    p_max_requests INTEGER,
    p_window_minutes INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    request_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO request_count
    FROM rate_limits
    WHERE identifier = p_identifier
      AND action_type = p_action_type
      AND created_at > NOW() - (p_window_minutes || ' minutes')::INTERVAL;

    RETURN request_count >= p_max_requests;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to record a rate limit attempt
CREATE OR REPLACE FUNCTION record_rate_limit(
    p_identifier TEXT,
    p_action_type TEXT
)
RETURNS void AS $$
BEGIN
    INSERT INTO rate_limits (identifier, action_type)
    VALUES (p_identifier, p_action_type);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Combined function: check and record in one call
-- Returns TRUE if allowed (and records the attempt), FALSE if rate limited
CREATE OR REPLACE FUNCTION check_and_record_rate_limit(
    p_identifier TEXT,
    p_action_type TEXT,
    p_max_requests INTEGER,
    p_window_minutes INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    is_limited BOOLEAN;
BEGIN
    -- Check if currently rate limited
    is_limited := check_rate_limit(p_identifier, p_action_type, p_max_requests, p_window_minutes);

    -- If not limited, record this attempt
    IF NOT is_limited THEN
        PERFORM record_rate_limit(p_identifier, p_action_type);
    END IF;

    -- Return TRUE if allowed (not limited), FALSE if blocked
    RETURN NOT is_limited;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Optional: Schedule cleanup (run daily via pg_cron if enabled)
-- SELECT cron.schedule('cleanup-rate-limits', '0 0 * * *', 'SELECT cleanup_old_rate_limits()');

-- Done! The rate limiting system is now ready.
