-- 0001_node_computers.sql
-- Schema stub for Flok Node Computers (Phase 1).
-- Not yet wired to a runtime migrator. Tables follow the build-plan §5 data model.
-- bird_id / flock_id are opaque text FKs until post-G0 integration with main Flok.

-- node_computers
CREATE TABLE IF NOT EXISTS node_computers (
  id                  TEXT PRIMARY KEY,
  bird_id             TEXT NOT NULL UNIQUE,
  flock_id            TEXT NOT NULL,
  provider            TEXT NOT NULL,
  provider_ref        TEXT,
  state               TEXT NOT NULL,
  os_type             TEXT NOT NULL DEFAULT 'linux',
  computer_class      TEXT,
  cpu                 INTEGER,
  memory_mb           INTEGER,
  disk_gb             INTEGER,
  base_image_version  TEXT,
  workspace_revision  INTEGER NOT NULL DEFAULT 0,
  last_active_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_node_computers_bird_id ON node_computers (bird_id);
CREATE INDEX IF NOT EXISTS idx_node_computers_flock_id ON node_computers (flock_id);
CREATE INDEX IF NOT EXISTS idx_node_computers_state ON node_computers (state);
CREATE INDEX IF NOT EXISTS idx_node_computers_provider_ref ON node_computers (provider_ref);

-- computer_pair_codes
CREATE TABLE IF NOT EXISTS computer_pair_codes (
  id            TEXT PRIMARY KEY,
  computer_id   TEXT NOT NULL REFERENCES node_computers (id) ON DELETE CASCADE,
  code_digest   TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pair_codes_computer ON computer_pair_codes (computer_id);

-- computer_capabilities
CREATE TABLE IF NOT EXISTS computer_capabilities (
  id            TEXT PRIMARY KEY,
  computer_id   TEXT NOT NULL REFERENCES node_computers (id) ON DELETE CASCADE,
  bird_id       TEXT NOT NULL,
  token_digest  TEXT NOT NULL,
  scopes        TEXT[] NOT NULL DEFAULT '{}',
  issued_at     TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_capabilities_token_digest ON computer_capabilities (token_digest);
CREATE INDEX IF NOT EXISTS idx_capabilities_computer ON computer_capabilities (computer_id);

-- computer_jobs
CREATE TABLE IF NOT EXISTS computer_jobs (
  id               TEXT PRIMARY KEY,
  computer_id      TEXT NOT NULL REFERENCES node_computers (id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  status           TEXT NOT NULL,
  attempt          INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 3,
  lease_owner      TEXT,
  lease_until      TIMESTAMPTZ,
  idempotency_key  TEXT NOT NULL,
  available_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  last_error_code  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency ON computer_jobs (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_jobs_status_available ON computer_jobs (status, available_at);
CREATE INDEX IF NOT EXISTS idx_jobs_lease_until ON computer_jobs (lease_until);

-- computer_checkpoints
CREATE TABLE IF NOT EXISTS computer_checkpoints (
  id                     TEXT PRIMARY KEY,
  computer_id            TEXT NOT NULL REFERENCES node_computers (id) ON DELETE CASCADE,
  revision               INTEGER NOT NULL,
  provider_snapshot_ref  TEXT,
  workspace_object_key   TEXT NOT NULL,
  sha256                 TEXT NOT NULL,
  base_image_version     TEXT NOT NULL,
  size_bytes             BIGINT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_computer ON computer_checkpoints (computer_id);

-- computer_handoffs
CREATE TABLE IF NOT EXISTS computer_handoffs (
  id                   TEXT PRIMARY KEY,
  source_bird_id       TEXT NOT NULL,
  destination_bird_id  TEXT NOT NULL,
  artifact_object_key  TEXT NOT NULL,
  sha256               TEXT NOT NULL,
  filename             TEXT NOT NULL,
  mime_type            TEXT NOT NULL,
  size_bytes           BIGINT NOT NULL,
  status               TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at          TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_handoffs_dest ON computer_handoffs (destination_bird_id, status);

-- computer_audit_events (metadata only)
CREATE TABLE IF NOT EXISTS computer_audit_events (
  id            TEXT PRIMARY KEY,
  computer_id   TEXT NOT NULL,
  bird_id       TEXT NOT NULL,
  operation     TEXT NOT NULL,
  target_class  TEXT,
  started_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ,
  success       BOOLEAN NOT NULL,
  error_code    TEXT,
  trace_id      TEXT,
  receipt_id    TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_computer ON computer_audit_events (computer_id);
CREATE INDEX IF NOT EXISTS idx_audit_bird ON computer_audit_events (bird_id);
