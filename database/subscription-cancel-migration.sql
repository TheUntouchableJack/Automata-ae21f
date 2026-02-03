-- Subscription Cancellation Migration
-- Adds column to track scheduled cancellation date for "cancel at period end" feature
-- Run this after stripe-subscription-migration.sql

-- =====================================================
-- ADD CANCELLATION TRACKING COLUMN
-- =====================================================

-- When subscription is set to cancel at period end, this stores when it will end
-- NULL means subscription is active and not scheduled for cancellation
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_cancel_at TIMESTAMPTZ;

-- =====================================================
-- COMMENT ON COLUMN
-- =====================================================

COMMENT ON COLUMN organizations.subscription_cancel_at IS
  'When subscription will end (cancel_at_period_end). NULL if not canceling. User keeps full access until this date.';
