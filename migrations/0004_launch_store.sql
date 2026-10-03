-- 0004_launch_store.sql
-- Durable seats + computer control plane for Vercel/Postgres (Neon compatible).
-- Apply after 0003_web_seats.sql. Requires DATABASE_URL.

ALTER TABLE billing_seats
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT,
  ADD COLUMN IF NOT EXISTS seconds_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overage_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_computers INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS agent_quantity INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS computer_ids TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_metered_at TIMESTAMPTZ;

ALTER TABLE billing_seats
  ALTER COLUMN hours_used TYPE DOUBLE PRECISION USING hours_used::double precision;

CREATE TABLE IF NOT EXISTS control_plane_snapshots (
  id          TEXT PRIMARY KEY,
  snapshot    JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_events (
  id           TEXT PRIMARY KEY,
  seat_id      TEXT NOT NULL,
  computer_id  TEXT,
  seconds      INTEGER NOT NULL,
  reason       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_seats_status ON billing_seats (status);
CREATE INDEX IF NOT EXISTS idx_usage_events_seat ON usage_events (seat_id);
