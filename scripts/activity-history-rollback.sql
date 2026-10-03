-- Roll back 0013 only. Does not drop computer_activity_events or 0012 columns.
-- OWNER-APPLIED. Pause computers first. In-flight intent rows without an
-- outcome are UNCERTAIN and this script deletes that attribution.
-- After this file, the previous application can insert the original columns.
-- Do not resume consequential tools on a build that swallows history failures.

DROP POLICY IF EXISTS activity_tenant_select ON computer_activity_events;
DROP POLICY IF EXISTS activity_tenant_insert ON computer_activity_events;
DROP POLICY IF EXISTS activity_preauth_denial_insert ON computer_activity_events;
DROP POLICY IF EXISTS activity_retention_delete ON computer_activity_events;

ALTER TABLE computer_activity_events DISABLE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS uq_activity_history_attempt_stage;
DROP INDEX IF EXISTS idx_activity_tenant_computer_at;
DROP INDEX IF EXISTS idx_activity_request;
DROP INDEX IF EXISTS idx_activity_open_intent;

ALTER TABLE computer_activity_events DROP CONSTRAINT IF EXISTS computer_activity_events_metadata_check;
ALTER TABLE computer_activity_events DROP CONSTRAINT IF EXISTS computer_activity_events_intent_tenant_check;
ALTER TABLE computer_activity_events DROP CONSTRAINT IF EXISTS computer_activity_events_coverage_check;
ALTER TABLE computer_activity_events DROP CONSTRAINT IF EXISTS computer_activity_events_outcome_check;
ALTER TABLE computer_activity_events DROP CONSTRAINT IF EXISTS computer_activity_events_stage_check;

DROP FUNCTION IF EXISTS staxions_purge_activity_history(timestamptz);
DROP FUNCTION IF EXISTS staxions_activity_metadata_ok(jsonb);

ALTER TABLE computer_activity_events
  DROP COLUMN IF EXISTS metadata,
  DROP COLUMN IF EXISTS coverage,
  DROP COLUMN IF EXISTS recorded_at,
  DROP COLUMN IF EXISTS outcome,
  DROP COLUMN IF EXISTS stage,
  DROP COLUMN IF EXISTS attempt_id,
  DROP COLUMN IF EXISTS operation_id,
  DROP COLUMN IF EXISTS request_id,
  DROP COLUMN IF EXISTS owner_id,
  DROP COLUMN IF EXISTS actor_id,
  DROP COLUMN IF EXISTS tenant_id;
