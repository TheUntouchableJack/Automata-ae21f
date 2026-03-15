-- MFA: trusted_devices table + profile columns
-- Phase 1: TOTP, Email OTP, and Trusted Device support

-- ── Profile additions ────────────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mfa_enabled   BOOLEAN  DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mfa_methods   TEXT[]   DEFAULT '{}';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_number  TEXT;

-- ── Trusted devices ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trusted_devices (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_token_hash TEXT        NOT NULL,
  device_label      TEXT,
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);

CREATE INDEX IF NOT EXISTS trusted_devices_user_id_idx ON trusted_devices(user_id);
CREATE INDEX IF NOT EXISTS trusted_devices_token_idx   ON trusted_devices(device_token_hash);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE trusted_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trusted devices"
  ON trusted_devices FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own trusted devices"
  ON trusted_devices FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own trusted devices"
  ON trusted_devices FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own trusted devices"
  ON trusted_devices FOR DELETE
  USING (user_id = auth.uid());

-- ── Auto-expire cleanup (called by cron or on lookup) ────────────────────────
CREATE OR REPLACE FUNCTION clean_expired_trusted_devices()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM trusted_devices WHERE expires_at < NOW();
END;
$$;
