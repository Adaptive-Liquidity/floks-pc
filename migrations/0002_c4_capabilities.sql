-- 0002_c4_capabilities.sql
-- C4: bind pair codes and capabilities to exact computer/bird/flock identity.
-- Store digests only. Scopes are explicit. Never persist raw pair codes or tokens.

-- Pair codes already issued for a computer are identity-bound so a later
-- computer-row mutation cannot rebind an outstanding code.
ALTER TABLE computer_pair_codes
  ADD COLUMN IF NOT EXISTS bird_id TEXT NOT NULL DEFAULT '';

ALTER TABLE computer_pair_codes
  ADD COLUMN IF NOT EXISTS flock_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pair_codes_digest ON computer_pair_codes (code_digest);
CREATE INDEX IF NOT EXISTS idx_pair_codes_identity ON computer_pair_codes (bird_id, flock_id);

-- Capabilities must be bound to flock as well as computer + bird.
ALTER TABLE computer_capabilities
  ADD COLUMN IF NOT EXISTS flock_id TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_capabilities_token_digest_unique
  ON computer_capabilities (token_digest);

CREATE INDEX IF NOT EXISTS idx_capabilities_identity
  ON computer_capabilities (computer_id, bird_id, flock_id);
