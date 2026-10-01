-- 0005_pair_reveals.sql
-- One-time pair-code reveal so a second serverless instance can show the code.
-- Apply after 0004_launch_store.sql. Raw code is deleted on revoke.

CREATE TABLE IF NOT EXISTS pair_code_reveals (
  seat_id      TEXT PRIMARY KEY,
  code         TEXT NOT NULL,
  pair_code_id TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
