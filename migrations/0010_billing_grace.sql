-- 0010_billing_grace.sql
-- Payment-failure / cancel grace, durable bind failures, Stripe event lease.
-- Apply after 0009_pending_binds.sql.
-- FILE ONLY in this PR. Do not apply to a live database from the PR.

ALTER TABLE billing_seats
  ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_event_at TIMESTAMPTZ;

ALTER TABLE pending_binds
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fail_reason TEXT;

ALTER TABLE stripe_events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done',
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
