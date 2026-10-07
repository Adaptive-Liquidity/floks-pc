-- 0003_web_seats.sql
-- Public /setup seat ledger. Email is stored lowercase.
-- 0001/0002 remain the computer/pair/capability schema.

CREATE TABLE IF NOT EXISTS billing_seats (
  id                          TEXT PRIMARY KEY,
  email                       TEXT NOT NULL,
  plan                        TEXT NOT NULL,
  status                      TEXT NOT NULL,
  stripe_customer_id          TEXT NOT NULL,
  stripe_subscription_id      TEXT,
  stripe_checkout_session_id  TEXT,
  hours_included              INTEGER NOT NULL,
  hours_used                  INTEGER NOT NULL DEFAULT 0,
  period_start                TIMESTAMPTZ,
  period_end                  TIMESTAMPTZ,
  computer_id                 TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_seats_email ON billing_seats (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_seats_checkout
  ON billing_seats (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_seats_subscription
  ON billing_seats (stripe_subscription_id);
