-- MFA Email OTP: codes table for email-based two-factor authentication

CREATE TABLE IF NOT EXISTS mfa_email_codes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code        TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
  verified    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mfa_email_codes_user_id_idx ON mfa_email_codes(user_id);
CREATE INDEX IF NOT EXISTS mfa_email_codes_expires_idx ON mfa_email_codes(expires_at);

-- RLS: service role only (edge function handles all access)
ALTER TABLE mfa_email_codes ENABLE ROW LEVEL SECURITY;

-- No user-facing policies — all operations go through the edge function
-- using service_role key. This prevents users from reading their own codes.

-- Cleanup function for expired codes
CREATE OR REPLACE FUNCTION clean_expired_mfa_codes()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM mfa_email_codes WHERE expires_at < NOW();
END;
$$;

-- Cron: clean expired codes every hour
SELECT cron.schedule(
  'clean-expired-mfa-codes',
  '0 * * * *',
  $$SELECT clean_expired_mfa_codes()$$
);
