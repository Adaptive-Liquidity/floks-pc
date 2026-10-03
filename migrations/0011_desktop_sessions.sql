-- 0011_desktop_sessions.sql
-- Owner live-screen sessions (nonce + revoke). HMAC still authorizes the token.
-- Do NOT apply this to a live database from this change. Flag only.

CREATE TABLE IF NOT EXISTS desktop_sessions (
  nonce        TEXT PRIMARY KEY,
  computer_id  TEXT NOT NULL,
  email        TEXT NOT NULL,
  subject      TEXT NOT NULL,
  mode         TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS desktop_sessions_computer_email_idx
  ON desktop_sessions (computer_id, email);
