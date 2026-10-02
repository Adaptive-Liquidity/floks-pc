-- 0010_billing_grace.sql
-- Payment-failure / cancel grace. Apply after 0009_pending_binds.sql.
-- FILE ONLY in this PR. Do not apply to a live database from the PR.

ALTER TABLE billing_seats
  ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_event_at TIMESTAMPTZ;
