# Activity history

Tool-level history for the eight MCP tools and the owner controls that go through `ComputerService`. One call is one attempt. An `exec` row does not list each shell command, and an `act` row does not list coordinates, typed text, or page contents.

This is not a tamper-evident log and it is not signed. A database administrator inside the trust boundary can update or delete rows. Retention deletes rows older than 30 days.

## What is stored

`migrations/0012_computer_activity_events.sql` created `computer_activity_events`. `migrations/0013_computer_activity_history.sql` adds attribution columns. 0012 is not edited.

| Field | Meaning |
| --- | --- |
| `tenant_id` | Flock or account tenant. Null only on a pre-auth denial. |
| `actor_id` | Bot bird or signed-in subject. Null before authentication. |
| `owner_id` | Owner subject when the request has one. |
| `request_id` | One MCP or owner request. |
| `operation_id` + `attempt_id` | One logical attempt. Intent and outcome share both. |
| `stage` | `intent`, `outcome`, `denial`, or `emergency`. |
| `outcome` | `succeeded`, `failed`, `denied`, or `UNCERTAIN`. |
| `metadata` | Allowlisted counts and names. Coverage is always `tool`. |

Not stored: command argv and output, file paths and bytes, cookies, screenshots, page contents, tokens, pair codes, or provider secrets.

The owner dashboard lists `outcome`, `denial`, `emergency`, and legacy rows whose `stage` is null. Intent rows stay for reconciliation and are not the activity page.

Successful `initialize`, `ping`, and `tools/list` are not history rows. Rejected MCP calls are, including HTTP 401 before an actor exists.

## Durability

Consequential tool calls (`computer_exec`, `computer_fs`, `computer_observe`, `computer_act`, `computer_pair`, and owner desktop act/observe) write an **intent** row and wait for it before the provider call. If that write fails, the call returns `ACTIVITY_HISTORY_UNAVAILABLE` and the provider is not called.

After the provider returns, the same attempt writes an **outcome** row. If that write fails, the response is `UNCERTAIN`: the effect may have happened, `retry` is false, and the client must not run the attempt again. The intent row with no outcome is the reconciliation marker. A follow-up marker with `outcome = 'UNCERTAIN'` is written when the database still accepts it. Nothing in this path retries the computer action.

Open intents:

```sql
SELECT i.*
  FROM computer_activity_events i
 WHERE i.stage = 'intent'
   AND NOT EXISTS (
     SELECT 1
       FROM computer_activity_events o
      WHERE o.operation_id = i.operation_id
        AND o.attempt_id = i.attempt_id
        AND o.stage = 'outcome'
   );
```

`pause`, `stop` (suspend), `revoke_capability`, and `revoke_bound` are emergency controls. Their history write is awaited, and a failure raises `activity.history.capacity` on stderr, but the control still completes. A missing history sink must not make stopping unsafe work impossible.

A missing table (`42P01`) or a failed write is an error from `PostgresActivityStore`. It is not an empty log and it is not a successful append. The activity API returns 503 `ACTIVITY_HISTORY_UNAVAILABLE`. There is no external pager in this repository; the stderr event is the alert.

## Retention and roles

Rows older than 30 days are eligible for deletion. Nothing deletes them on the request path. The owner runs:

```sql
SELECT staxions_purge_activity_history(now());
```

That is the retention process. It is not an unlimited evidence hold.

`scripts/activity-history-roles.sql` creates three non-owner, non-`BYPASSRLS` roles:

- `staxions_activity_app` — insert and select, tenant GUC `staxions.tenant_id`
- `staxions_activity_reader` — select only, same GUC
- `staxions_activity_retention` — select and delete only rows older than 30 days

Row level security is enabled and not forced, so today's owner `DATABASE_URL` still works. Tenant isolation for the app role is the policy plus `set_config('staxions.tenant_id', ..., true)` on each statement. Pre-auth denials insert with a null tenant and a null actor; the app role cannot select another tenant's rows.

Pointing `DATABASE_URL` at `staxions_activity_app` is an owner environment change. This change does not do that.

## Apply and roll back

Apply only after the owner approves the database:

```bash
npm run migrate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/activity-history-roles.sql
```

`npm run migrate` records `0013_computer_activity_history.sql` in `schema_migrations`. It does not create roles.

Whether 0012 or 0013 is already applied on any live database is unknown from this repository. Do not treat a file on the branch as a migrated database.

Rollback of the schema, after pausing computers:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/activity-history-rollback.sql
```

The 0012 table and its original columns remain. Application rollback is a revert of this commit on the launch branch, or a Vercel point-back to the previous deployment. Do not restore the old detached writer while consequential tools stay enabled: that writer reported success when the table was missing.
