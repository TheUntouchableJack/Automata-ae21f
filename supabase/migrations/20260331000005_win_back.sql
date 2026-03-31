-- Phase 5: Win-Back for Churned Paying Customers
-- Adds cancellation tracking + seeds win-back email sequence

-- ============================================================
-- Cancellation tracking columns
-- ============================================================
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- ============================================================
-- Seed: Win-back sequence (3 emails over 30 days)
-- Triggered by stripe-webhook on customer.subscription.deleted
-- Processed by royalty-self-growth nightly loop (reuses Phase 2 infra)
-- ============================================================
INSERT INTO smb_email_sequences (sequence_key, name, description, steps) VALUES (
  'win_back',
  'Churned Customer Win-Back',
  '3-email sequence for paying customers who cancel their subscription',
  '[
    {
      "step": 1,
      "template_key": "winback_sorry",
      "delay_hours": 24,
      "skip_condition": "has_resubscribed",
      "subject_hint": "We are sorry to see you go"
    },
    {
      "step": 2,
      "template_key": "winback_miss_you",
      "delay_hours": 168,
      "skip_condition": "has_resubscribed",
      "subject_hint": "Your customers miss you"
    },
    {
      "step": 3,
      "template_key": "winback_offer",
      "delay_hours": 720,
      "skip_condition": "has_resubscribed",
      "subject_hint": "Special offer to come back"
    }
  ]'::jsonb
) ON CONFLICT (sequence_key) DO NOTHING;
