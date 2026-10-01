-- 0008_stripe_events.sql
-- Idempotent Stripe deliveries. Apply after 0007_oauth.sql.

CREATE TABLE IF NOT EXISTS stripe_events (
  id          TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
