-- 0002_c4_capabilities.sql
-- C4 schema delta. 0001 is immutable.
-- Digest-only pair codes and capabilities. Bind bird_id + flock_id.
-- Explicit scopes already exist on computer_capabilities from 0001.

ALTER TABLE computer_pair_codes
  ADD COLUMN IF NOT EXISTS bird_id TEXT NOT NULL DEFAULT '';

ALTER TABLE computer_pair_codes
  ADD COLUMN IF NOT EXISTS flock_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pair_codes_digest ON computer_pair_codes (code_digest);
CREATE INDEX IF NOT EXISTS idx_pair_codes_identity ON computer_pair_codes (bird_id, flock_id);

ALTER TABLE computer_capabilities
  ADD COLUMN IF NOT EXISTS flock_id TEXT NOT NULL DEFAULT '';

-- 0001 created a non-unique digest index. Replace it in place (same name)
-- so fresh and already-applied databases end with one unique index.
DROP INDEX IF EXISTS idx_capabilities_token_digest;
CREATE UNIQUE INDEX IF NOT EXISTS idx_capabilities_token_digest
  ON computer_capabilities (token_digest);

CREATE INDEX IF NOT EXISTS idx_capabilities_identity
  ON computer_capabilities (computer_id, bird_id, flock_id);
