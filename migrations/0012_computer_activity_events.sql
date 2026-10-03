-- 0012_computer_activity_events.sql
-- OWNER-APPLIED. Do not run this from a code PR. Do not apply on preview
-- or production as part of this change. Flag only until the owner runs
-- `npm run migrate` (or applies this file) against DATABASE_URL.
-- 0010 is reserved for billing; 0011 is reserved for desktop sessions.
--
-- Metadata-only activity for the owner dashboard. Persist observe / act /
-- exec / fs / handoff / lifecycle events. Never store tokens, pair codes,
-- command output, screenshots, cookies, or page contents.
-- Retention: 30 days. Rows older than that are eligible for delete.

CREATE TABLE IF NOT EXISTS computer_activity_events (
  id           TEXT PRIMARY KEY,
  at           TIMESTAMPTZ NOT NULL,
  computer_id  TEXT,
  bird_id      TEXT,
  kind         TEXT NOT NULL,
  operation    TEXT NOT NULL,
  success      BOOLEAN NOT NULL,
  error_code   TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_computer_at
  ON computer_activity_events (computer_id, at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_activity_at
  ON computer_activity_events (at);
