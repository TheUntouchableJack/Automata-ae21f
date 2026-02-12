-- Migration: Payment Failure Tracking
-- Adds columns to track payment failures for dunning flow

-- Add columns for payment failure tracking
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS payment_failure_count INTEGER DEFAULT 0;

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS last_payment_failure_at TIMESTAMPTZ;

-- Comments
COMMENT ON COLUMN organizations.payment_failure_count IS 'Number of consecutive payment failures (resets on success)';
COMMENT ON COLUMN organizations.last_payment_failure_at IS 'Timestamp of most recent payment failure';

-- Also reset payment failure count when payment succeeds
-- This is handled in stripe-webhook but adding a function for safety
CREATE OR REPLACE FUNCTION reset_payment_failure_on_success()
RETURNS TRIGGER AS $$
BEGIN
  -- When subscription_status changes to 'active', reset failure tracking
  IF OLD.subscription_status != 'active' AND NEW.subscription_status = 'active' THEN
    NEW.payment_failure_count := 0;
    NEW.last_payment_failure_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS reset_payment_failure ON organizations;
CREATE TRIGGER reset_payment_failure
  BEFORE UPDATE OF subscription_status ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION reset_payment_failure_on_success();
