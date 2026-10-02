-- 0009_pending_binds.sql
-- Computer chosen on Allow, plus a one-time checkout bind for a Bot with no computer.
-- Idempotent. Apply after 0008_stripe_events.sql.

ALTER TABLE oauth_codes ADD COLUMN IF NOT EXISTS computer_id TEXT;
ALTER TABLE oauth_codes ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE oauth_access_tokens ADD COLUMN IF NOT EXISTS computer_id TEXT;
ALTER TABLE oauth_access_tokens ADD COLUMN IF NOT EXISTS capability_id TEXT;
ALTER TABLE oauth_access_tokens ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE oauth_access_tokens ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS client_name TEXT;
CREATE INDEX IF NOT EXISTS oauth_access_tokens_computer_id_idx ON oauth_access_tokens (computer_id);

CREATE TABLE IF NOT EXISTS pending_binds (
  nonce       TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  subject     TEXT NOT NULL,
  flock       TEXT NOT NULL,
  plan        TEXT NOT NULL,
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  opened_at   TIMESTAMPTZ,
  used_at     TIMESTAMPTZ
);
