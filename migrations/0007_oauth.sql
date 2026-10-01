-- 0007_oauth.sql
-- OAuth clients, one-time codes, and hashed access tokens.
-- Apply after 0006_rate_limits.sql.

CREATE TABLE IF NOT EXISTS oauth_clients (
  id            TEXT PRIMARY KEY,
  redirect_uris TEXT[] NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code         TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  challenge    TEXT NOT NULL,
  subject      TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used         BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,
  subject    TEXT NOT NULL,
  client_id  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked    BOOLEAN NOT NULL DEFAULT FALSE
);
