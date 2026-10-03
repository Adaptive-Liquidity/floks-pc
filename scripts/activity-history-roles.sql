-- Least-privilege roles for computer_activity_events.
-- OWNER-APPLIED. Do not run this from the Node migrator: CREATE ROLE cannot
-- run inside the transaction that applies migrations/*.sql.
-- Run with psql, without --single-transaction:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/activity-history-roles.sql
--
-- The application DATABASE_URL is still the table owner until you point it at
-- staxions_activity_app. The owner bypasses row level security because 0013
-- does not FORCE ROW LEVEL SECURITY. These roles are the isolation boundary.
-- None of them is SUPERUSER or BYPASSRLS. Switching DATABASE_URL is a separate
-- owner change; this pull request does not change environment variables.
--
-- staxions_activity_app       INSERT + SELECT, tenant GUC required
-- staxions_activity_reader    SELECT only, tenant GUC required
-- staxions_activity_retention DELETE of rows older than 30 days, via the purge function

SELECT 'CREATE ROLE staxions_activity_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'staxions_activity_app')\gexec
SELECT 'CREATE ROLE staxions_activity_reader NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'staxions_activity_reader')\gexec
SELECT 'CREATE ROLE staxions_activity_retention NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'staxions_activity_retention')\gexec

GRANT SELECT, INSERT ON computer_activity_events TO staxions_activity_app;
GRANT SELECT ON computer_activity_events TO staxions_activity_reader;
-- DELETE reads the WHERE clause, so retention also needs SELECT.
-- The select policy is limited to rows already past the 30-day retention window.
GRANT SELECT, DELETE ON computer_activity_events TO staxions_activity_retention;

DROP POLICY IF EXISTS activity_retention_select ON computer_activity_events;
CREATE POLICY activity_retention_select ON computer_activity_events
  FOR SELECT
  TO staxions_activity_retention
  USING (at < now() - interval '30 days');
GRANT EXECUTE ON FUNCTION staxions_purge_activity_history(timestamptz) TO staxions_activity_retention;
GRANT EXECUTE ON FUNCTION staxions_activity_metadata_ok(jsonb) TO staxions_activity_app;
GRANT EXECUTE ON FUNCTION staxions_activity_metadata_ok(jsonb) TO staxions_activity_reader;
GRANT EXECUTE ON FUNCTION staxions_activity_metadata_ok(jsonb) TO staxions_activity_retention;
