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
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- Rows written before this migration were finished deliveries.
UPDATE stripe_events
   SET status = 'done'
 WHERE status IS NULL;

-- Re-running this file after the r4-era 0010 (status DEFAULT 'done') is a no-op
-- on ADD COLUMN IF NOT EXISTS. Apply this ALTER by hand if the runner skipped it.
ALTER TABLE stripe_events
  ALTER COLUMN status SET DEFAULT 'processing',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN claimed_at SET DEFAULT NOW();
