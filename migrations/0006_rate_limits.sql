-- 0006_rate_limits.sql
-- Durable request counters. Apply after 0005_pair_reveals.sql.

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  hit_count  INTEGER NOT NULL,
  reset_at   TIMESTAMPTZ NOT NULL
);
