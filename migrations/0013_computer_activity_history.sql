-- 0013_computer_activity_history.sql
-- OWNER-APPLIED. Do not run this from a code PR. Do not apply it to a live
-- database from this change. 0012_computer_activity_events.sql is unchanged.
--
-- This file is activity history at tool coverage: one intent and one outcome
-- for an MCP tool call or an owner control. It is not a command-by-command
-- shell audit, and it is not a tamper-evident or signed log.
--
-- Compatibility: every new column is nullable. A writer that still inserts
-- only the 0012 columns (id, at, computer_id, bird_id, kind, operation,
-- success, error_code) keeps working. New writers set tenant, actor, request,
-- operation, attempt, stage, outcome, and allowlisted metadata.
-- Row level security is enabled and not forced, so the current table owner
-- (typical DATABASE_URL) is unchanged until the owner adopts the roles in
-- scripts/activity-history-roles.sql. Those roles are not created here
-- because role creation cannot run inside the migrator's transaction.
--
-- Rollback: scripts/activity-history-rollback.sql drops the added columns,
-- policies, and helper. It does not drop computer_activity_events. Pause,
-- stop, and revoke still run if this history sink is down. Do not roll the
-- application back to detached writes while leaving consequential tools
-- enabled without another recorded intent path.

ALTER TABLE computer_activity_events
  ADD COLUMN IF NOT EXISTS tenant_id TEXT,
  ADD COLUMN IF NOT EXISTS actor_id TEXT,
  ADD COLUMN IF NOT EXISTS owner_id TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS operation_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt_id TEXT,
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS coverage TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE computer_activity_events DROP CONSTRAINT IF EXISTS computer_activity_events_stage_check;
ALTER TABLE computer_activity_events
  ADD CONSTRAINT computer_activity_events_stage_check
  CHECK (stage IS NULL OR stage IN ('intent', 'outcome', 'denial', 'emergency'));

ALTER TABLE computer_activity_events DROP CONSTRAINT IF EXISTS computer_activity_events_outcome_check;
ALTER TABLE computer_activity_events
  ADD CONSTRAINT computer_activity_events_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('succeeded', 'failed', 'denied', 'UNCERTAIN'));

ALTER TABLE computer_activity_events DROP CONSTRAINT IF EXISTS computer_activity_events_coverage_check;
ALTER TABLE computer_activity_events
  ADD CONSTRAINT computer_activity_events_coverage_check
  CHECK (coverage IS NULL OR coverage = 'tool');

ALTER TABLE computer_activity_events DROP CONSTRAINT IF EXISTS computer_activity_events_intent_tenant_check;
ALTER TABLE computer_activity_events
  ADD CONSTRAINT computer_activity_events_intent_tenant_check
  CHECK (stage IS DISTINCT FROM 'intent' OR tenant_id IS NOT NULL);

CREATE OR REPLACE FUNCTION staxions_activity_metadata_ok(meta jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT meta IS NULL
    OR (
      NOT EXISTS (
        SELECT 1
          FROM jsonb_object_keys(meta) AS key
         WHERE key <> ALL (ARRAY[
           'coverage', 'tool', 'method', 'fsOperation', 'actionCount',
           'argvCount', 'exitCode', 'timedOut', 'effect'
         ])
      )
      AND (meta->>'coverage' IS NULL OR meta->>'coverage' = 'tool')
    );
$$;

ALTER TABLE computer_activity_events DROP CONSTRAINT IF EXISTS computer_activity_events_metadata_check;
ALTER TABLE computer_activity_events
  ADD CONSTRAINT computer_activity_events_metadata_check
  CHECK (staxions_activity_metadata_ok(metadata));

CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_history_attempt_stage
  ON computer_activity_events (tenant_id, operation_id, attempt_id, stage)
  WHERE tenant_id IS NOT NULL
    AND operation_id IS NOT NULL
    AND attempt_id IS NOT NULL
    AND stage IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_tenant_computer_at
  ON computer_activity_events (tenant_id, computer_id, at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_activity_request
  ON computer_activity_events (tenant_id, request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_open_intent
  ON computer_activity_events (tenant_id, operation_id, attempt_id)
  WHERE stage = 'intent';

-- 30-day activity history. This is a retention delete, not an evidence hold.
CREATE OR REPLACE FUNCTION staxions_purge_activity_history(now_ts timestamptz)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  removed bigint;
BEGIN
  DELETE FROM computer_activity_events
   WHERE at < now_ts - interval '30 days';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION staxions_purge_activity_history(timestamptz) FROM PUBLIC;

ALTER TABLE computer_activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_tenant_select ON computer_activity_events;
CREATE POLICY activity_tenant_select ON computer_activity_events
  FOR SELECT
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = current_setting('staxions.tenant_id', true)
  );

DROP POLICY IF EXISTS activity_tenant_insert ON computer_activity_events;
CREATE POLICY activity_tenant_insert ON computer_activity_events
  FOR INSERT
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = current_setting('staxions.tenant_id', true)
  );

-- Rejected calls before authentication have no actor and no tenant.
DROP POLICY IF EXISTS activity_preauth_denial_insert ON computer_activity_events;
CREATE POLICY activity_preauth_denial_insert ON computer_activity_events
  FOR INSERT
  WITH CHECK (
    tenant_id IS NULL
    AND actor_id IS NULL
    AND owner_id IS NULL
    AND stage = 'denial'
  );

-- No UPDATE policy: history rows are not rewritten.
DROP POLICY IF EXISTS activity_retention_delete ON computer_activity_events;
CREATE POLICY activity_retention_delete ON computer_activity_events
  FOR DELETE
  USING (at < now() - interval '30 days');

REVOKE ALL ON computer_activity_events FROM PUBLIC;
