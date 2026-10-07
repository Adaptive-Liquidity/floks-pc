-- 0013_mcp_audit_events.sql
-- OWNER-APPLIED. Do not run this from a code change. Do not apply on preview
-- or production until the owner approves this file. 0001 through 0012 are
-- already recorded on preview and must not be applied again.
--
-- One metadata row per production MCP call. Never store command output,
-- tokens, pair codes, screenshots, cookies, or page contents.
-- computer_id and bird_id are nullable because a call can happen before a
-- computer exists. 0001's unused computer_audit_events table is not reused.

CREATE TABLE IF NOT EXISTS computer_audit_events (
  id            TEXT PRIMARY KEY,
  computer_id   TEXT,
  bird_id       TEXT,
  operation     TEXT NOT NULL,
  target_class  TEXT,
  started_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ,
  success       BOOLEAN NOT NULL,
  error_code    TEXT,
  trace_id      TEXT,
  receipt_id    TEXT
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_computer
  ON computer_audit_events (computer_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_started
  ON computer_audit_events (started_at);
