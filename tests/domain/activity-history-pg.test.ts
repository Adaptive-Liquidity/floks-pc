import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ActivityHistoryUnavailable,
  ActivityOutcomeUncertain,
  ComputerService,
  FakeProvider,
  activityAttribution,
  recentActivityCapacityAlerts,
  type ActivityEvent,
  type ActivityStore,
} from "../../src/lib/computers/index.js";
import { McpGateway } from "../../src/lib/mcp/handler.js";
import { PostgresActivityStore } from "../../web/lib/store/activity-pg.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(new URL("../../web/package.json", import.meta.url));
const Pg = require("pg") as {
  Client: new (config: { connectionString: string }) => {
    connect(): Promise<void>;
    query(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
    end(): Promise<void>;
  };
};

const OS_USER = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
const DB = "staxions_activity_history_test";
const EMPTY_DB = "staxions_activity_history_empty";
const LEGACY_DB = "staxions_activity_history_0012";
const ROLLBACK_DB = "staxions_activity_history_rollback";

function storeReason(err: unknown): string | null {
  if (!err || typeof err !== "object" || !("name" in err) || !("reason" in err)) return null;
  if (err.name !== "ActivityStoreError") return null;
  return typeof err.reason === "string" ? err.reason : null;
}

function dbUrl(name: string): string {
  return `postgres://${OS_USER}@/${name}?host=/var/run/postgresql`;
}

function psqlAdmin(database: string, sql: string): void {
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-d", database, "-c", sql], { stdio: "pipe" });
}

function psqlFile(database: string, file: string): void {
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-d", database, "-f", file], { stdio: "pipe" });
}

async function withClient<T>(
  database: string,
  fn: (client: InstanceType<typeof Pg.Client>) => Promise<T>,
): Promise<T> {
  const client = new Pg.Client({ connectionString: dbUrl(database) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function applySql(database: string, filename: string): Promise<void> {
  const sql = readFileSync(join(ROOT, "migrations", filename), "utf8");
  await withClient(database, async (client) => {
    await client.query(sql);
  });
}

describe("activity history postgres", { concurrency: 1 }, () => {
  before(() => {
    assert.match(OS_USER, /^[a-z_][a-z0-9_]{0,30}$/);
    try {
      execFileSync("sudo", ["-u", "postgres", "createuser", "-s", OS_USER], { stdio: "pipe" });
    } catch {
      /* the local superuser role already exists */
    }
    for (const name of [DB, EMPTY_DB, LEGACY_DB, ROLLBACK_DB]) {
      psqlAdmin(
        "postgres",
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid();`,
      );
      psqlAdmin("postgres", `DROP DATABASE IF EXISTS ${name}`);
      psqlAdmin("postgres", `CREATE DATABASE ${name}`);
    }
  });

  after(() => {
    for (const name of [DB, EMPTY_DB, LEGACY_DB, ROLLBACK_DB]) {
      try {
        psqlAdmin(
          "postgres",
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid();`,
        );
        psqlAdmin("postgres", `DROP DATABASE IF EXISTS ${name}`);
      } catch {
        /* leftover local test databases are not a live schema */
      }
    }
  });

  it("writes tool-level history on the postgres store and keeps secrets out of the row", async () => {
    await applySql(DB, "0012_computer_activity_events.sql");
    await applySql(DB, "0013_computer_activity_history.sql");
    psqlFile(DB, join(ROOT, "scripts/activity-history-roles.sql"));

    const secret = "secret-stdout-DO-NOT-STORE";
    const store = new PostgresActivityStore(dbUrl(DB));
    const service = new ComputerService(new FakeProvider(), { activityStore: store });
    const computer = await service.requestComputer({ birdId: "bird-pg", flockId: "tenant-a" });
    const issued = await service.issuePairCode(computer.id);
    const paired = await service.pair(issued.code, { birdId: "bird-pg", flockId: "tenant-a" });
    const gateway = new McpGateway(service);
    const response = await activityAttribution.run(
      {
        tenantId: "tenant-a",
        actorId: "bird-pg",
        ownerId: "owner-a",
        requestId: "request-pg-1",
      },
      () =>
        gateway.handleJsonRpc({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "computer_exec",
            arguments: {
              capability_token: paired.token,
              computer_handle: computer.id,
              argv: ["echo", secret],
            },
          },
        }),
    );
    assert.equal(
      response && typeof response === "object" && "result" in response,
      true,
    );

    const denied = await gateway.handleJsonRpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "computer_destroy", arguments: { argv: [secret] } },
    });
    const deniedText = JSON.stringify(denied);
    assert.match(deniedText, /UNKNOWN_TOOL/);

    const rows = await withClient(DB, async (client) => {
      const result = await client.query(
        `SELECT id, tenant_id, actor_id, owner_id, request_id, operation_id, attempt_id,
                stage, outcome, operation, coverage, metadata::text AS metadata
           FROM computer_activity_events
          ORDER BY at ASC, id ASC`,
      );
      return result.rows;
    });
    const blob = JSON.stringify(rows);
    assert.equal(blob.includes(secret), false);
    assert.equal(blob.includes(paired.token), false);
    assert.equal(blob.includes(issued.code), false);
    const execRows = rows.filter((row) => row.operation === "exec");
    assert.equal(execRows.length, 2);
    const intent = execRows.find((row) => row.stage === "intent");
    const outcome = execRows.find((row) => row.stage === "outcome");
    assert.ok(intent);
    assert.ok(outcome);
    assert.equal(intent.tenant_id, "tenant-a");
    assert.equal(intent.actor_id, "bird-pg");
    assert.equal(intent.owner_id, "owner-a");
    assert.equal(intent.request_id, "request-pg-1");
    assert.equal(outcome.operation_id, intent.operation_id);
    assert.equal(outcome.attempt_id, intent.attempt_id);
    assert.equal(outcome.outcome, "succeeded");
    assert.equal(outcome.coverage, "tool");
    assert.match(String(outcome.metadata), /"argvCount":\s*2/);
    assert.equal(
      rows.some((row) => row.stage === "denial" && row.operation === "unknown_tool"),
      true,
    );

    await withClient(DB, async (client) => {
      const legacy = await client.query(
        `INSERT INTO computer_activity_events
           (id, at, computer_id, bird_id, kind, operation, success, error_code)
         VALUES ('legacy-0012', now(), 'computer-legacy', 'bird-legacy', 'exec', 'exec', true, null)
         RETURNING id`,
      );
      assert.equal(legacy.rows[0]?.id, "legacy-0012");
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO computer_activity_events
               (id, at, kind, operation, success, metadata)
             VALUES ('bad-meta', now(), 'exec', 'exec', true, '{"stdout":"nope"}'::jsonb)`,
          ),
        (err: unknown) =>
          typeof err === "object" && err !== null && "code" in err && err.code === "23514",
      );
    });
  });

  it("isolates tenants for the app role and limits retention deletes", async () => {
    const owner = new PostgresActivityStore(dbUrl(DB));
    const now = new Date().toISOString();
    const fresh = (id: string, tenant: string, computer: string): ActivityEvent => ({
      id,
      at: now,
      computerId: computer,
      birdId: "bird",
      kind: "exec",
      operation: "exec",
      success: true,
      errorCode: null,
      tenantId: tenant,
      actorId: "actor",
      ownerId: "owner",
      requestId: `req-${id}`,
      operationId: `op-${id}`,
      attemptId: `at-${id}`,
      stage: "outcome",
      outcome: "succeeded",
      recordedAt: now,
      metadata: { coverage: "tool", argvCount: 1 },
    });
    await owner.append(fresh("row-a", "tenant-a", "computer-a"));
    await owner.append(fresh("row-b", "tenant-b", "computer-b"));
    const oldAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await owner.append({ ...fresh("row-old", "tenant-a", "computer-a"), at: oldAt, recordedAt: oldAt });

    const visibleToA = await owner.list("computer-a", { limit: 20, tenantId: "tenant-a" });
    assert.equal(
      visibleToA.events.every((event) => event.tenantId === "tenant-a" || event.tenantId == null),
      true,
    );
    assert.equal(visibleToA.events.some((event) => event.id === "row-b"), false);
    const crossed = await owner.list("computer-a", { limit: 20, tenantId: "tenant-b" });
    assert.equal(crossed.events.some((event) => event.id === "row-a"), false);

    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE staxions_activity_app");
      await client.query("SELECT set_config('staxions.tenant_id', 'tenant-a', true)");
      const own = await client.query(
        `SELECT id FROM computer_activity_events WHERE id IN ('row-a', 'row-b', 'row-old')`,
      );
      assert.deepEqual(
        own.rows.map((row) => row.id).sort(),
        ["row-a", "row-old"],
      );
      await client.query("SAVEPOINT app_denied");
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO computer_activity_events
               (id, at, kind, operation, success, tenant_id, actor_id, stage, outcome, coverage)
             VALUES ('cross-insert', now(), 'exec', 'exec', true, 'tenant-b', 'actor', 'outcome', 'succeeded', 'tool')`,
          ),
        (err: unknown) =>
          typeof err === "object" && err !== null && "code" in err && err.code === "42501",
      );
      await client.query("ROLLBACK TO SAVEPOINT app_denied");
      await client.query(
        `INSERT INTO computer_activity_events
           (id, at, kind, operation, success, tenant_id, actor_id, owner_id, stage, outcome, coverage)
         VALUES ('preauth', now(), 'fail-closed', 'mcp_http', false, NULL, NULL, NULL, 'denial', 'denied', 'tool')`,
      );
      const hiddenDenial = await client.query(`SELECT id FROM computer_activity_events WHERE id = 'preauth'`);
      assert.equal(hiddenDenial.rows.length, 0);
      await client.query("SAVEPOINT app_delete");
      await assert.rejects(
        () => client.query(`DELETE FROM computer_activity_events WHERE id = 'row-a'`),
        (err: unknown) =>
          typeof err === "object" && err !== null && "code" in err && err.code === "42501",
      );
      await client.query("ROLLBACK TO SAVEPOINT app_delete");
      await client.query("ROLLBACK");
    });

    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE staxions_activity_reader");
      await client.query("SELECT set_config('staxions.tenant_id', 'tenant-a', true)");
      await client.query("SAVEPOINT reader_insert");
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO computer_activity_events
               (id, at, kind, operation, success, tenant_id, stage, coverage)
             VALUES ('reader-insert', now(), 'exec', 'exec', true, 'tenant-a', 'outcome', 'tool')`,
          ),
        (err: unknown) =>
          typeof err === "object" && err !== null && "code" in err && err.code === "42501",
      );
      await client.query("ROLLBACK TO SAVEPOINT reader_insert");
      await client.query("ROLLBACK");
    });

    await withClient(DB, async (client) => {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE staxions_activity_retention");
      const freshDelete = await client.query(`DELETE FROM computer_activity_events WHERE id = 'row-a'`);
      assert.equal(freshDelete.rowCount, 0);
      const oldDelete = await client.query(`DELETE FROM computer_activity_events WHERE id = 'row-old'`);
      assert.equal(oldDelete.rowCount, 1);
      await client.query("COMMIT");
    });

    const removed = await owner.purgeExpired(Date.now());
    assert.equal(typeof removed, "number");
    const stillFresh = await withClient(DB, async (client) => {
      const result = await client.query(`SELECT id FROM computer_activity_events WHERE id = 'row-a'`);
      return result.rows.length;
    });
    assert.equal(stillFresh, 1);
  });

  it("records a pre-auth MCP denial and does not treat a missing table as success", async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = dbUrl(DB);
    try {
      const { POST } = await import("../../web/app/mcp/route.ts");
      const res = await POST(new Request("http://127.0.0.1/mcp", { method: "POST" }));
      assert.equal(res.status, 401);
      const denial = await withClient(DB, async (client) => {
        const result = await client.query(
          `SELECT actor_id, tenant_id, stage, outcome, operation
             FROM computer_activity_events
            WHERE operation = 'mcp_http' AND outcome = 'denied'
            ORDER BY at DESC
            LIMIT 1`,
        );
        return result.rows[0];
      });
      assert.ok(denial);
      assert.equal(denial.actor_id, null);
      assert.equal(denial.tenant_id, null);
      assert.equal(denial.stage, "denial");
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }

    const beforeAlerts = recentActivityCapacityAlerts().length;
    const missing = new PostgresActivityStore(dbUrl(EMPTY_DB));
    await assert.rejects(
      () =>
        missing.append({
          id: "missing-table",
          at: new Date().toISOString(),
          computerId: null,
          birdId: null,
          kind: "exec",
          operation: "exec",
          success: false,
          errorCode: null,
          tenantId: "tenant-a",
          stage: "intent",
          outcome: null,
          metadata: { coverage: "tool" },
        }),
      (err: unknown) => storeReason(err) === "missing_table",
    );

    const provider = new FakeProvider();
    let execs = 0;
    const orig = provider.exec.bind(provider);
    provider.exec = async (ref, request) => {
      execs += 1;
      return orig(ref, request);
    };
    const blocked = new ComputerService(provider, { activityStore: missing });
    const computer = await blocked.requestComputer({ birdId: "bird-missing", flockId: "tenant-a" });
    const issued = await blocked.issuePairCode(computer.id);
    await assert.rejects(
      () => blocked.pair(issued.code, { birdId: "bird-missing", flockId: "tenant-a" }),
      (err: unknown) => err instanceof ActivityHistoryUnavailable,
    );
    assert.equal(execs, 0);
    assert.ok(recentActivityCapacityAlerts().length > beforeAlerts);

    await applySql(LEGACY_DB, "0012_computer_activity_events.sql");
    const legacyStore = new PostgresActivityStore(dbUrl(LEGACY_DB));
    await assert.rejects(
      () =>
        legacyStore.append({
          id: "missing-column",
          at: new Date().toISOString(),
          computerId: "c",
          birdId: "b",
          kind: "exec",
          operation: "exec",
          success: false,
          errorCode: null,
          tenantId: "tenant-a",
          stage: "intent",
          metadata: { coverage: "tool" },
        }),
      (err: unknown) => storeReason(err) === "missing_column",
    );
  });

  it("marks UNCERTAIN when the outcome write fails after the effect", async () => {
    const provider = new FakeProvider();
    let execs = 0;
    const orig = provider.exec.bind(provider);
    provider.exec = async (ref, request) => {
      execs += 1;
      return orig(ref, request);
    };
    const real = new PostgresActivityStore(dbUrl(DB));
    let blockOutcomes = false;
    const store: ActivityStore = {
      async append(event: ActivityEvent) {
        if (blockOutcomes && event.stage === "outcome") throw new Error("outcome down");
        await real.append(event);
      },
      async list(computerId, opts) {
        return real.list(computerId, opts);
      },
      async purgeExpired(nowMs) {
        return real.purgeExpired(nowMs);
      },
    };
    const service = new ComputerService(provider, { activityStore: store });
    const computer = await service.requestComputer({ birdId: "bird-uncertain", flockId: "tenant-a" });
    const issued = await service.issuePairCode(computer.id);
    const paired = await activityAttribution.run(
      {
        tenantId: "tenant-a",
        actorId: "bird-uncertain",
        ownerId: "owner-a",
        requestId: "request-uncertain-setup",
      },
      () => service.pair(issued.code, { birdId: "bird-uncertain", flockId: "tenant-a" }),
    );
    blockOutcomes = true;
    execs = 0;
    await assert.rejects(
      () =>
        activityAttribution.run(
          {
            tenantId: "tenant-a",
            actorId: "bird-uncertain",
            ownerId: "owner-a",
            requestId: "request-uncertain",
          },
          () => service.exec({ kind: "capability", token: paired.token }, computer.id, { argv: ["echo", "do-not-store"] }),
        ),
      (err: unknown) => err instanceof ActivityOutcomeUncertain && err.code === "UNCERTAIN",
    );
    assert.equal(execs, 1);
    const execRows = await withClient(DB, async (client) => {
      const result = await client.query(
        `SELECT stage, outcome, metadata::text AS metadata
           FROM computer_activity_events
          WHERE request_id = 'request-uncertain'`,
      );
      return result.rows;
    });
    assert.equal(execRows.length, 1);
    assert.equal(execRows[0]?.stage, "intent");
    assert.equal(JSON.stringify(execRows).includes("do-not-store"), false);
  });

  it("fails a history write that the database rejects instead of reporting success", async () => {
    try {
      execFileSync(
        "psql",
        [
          "-d",
          "postgres",
          "-c",
          "CREATE ROLE staxions_activity_noinsert LOGIN PASSWORD 'activity-test' NOSUPERUSER NOBYPASSRLS",
        ],
        { stdio: "pipe" },
      );
    } catch {
      execFileSync(
        "psql",
        ["-d", "postgres", "-c", "ALTER ROLE staxions_activity_noinsert WITH PASSWORD 'activity-test' NOSUPERUSER NOBYPASSRLS"],
        { stdio: "pipe" },
      );
    }
    psqlAdmin(DB, "GRANT CONNECT ON DATABASE staxions_activity_history_test TO staxions_activity_noinsert");
    psqlAdmin(DB, "GRANT USAGE ON SCHEMA public TO staxions_activity_noinsert");
    const deniedUrl = `postgres://staxions_activity_noinsert:activity-test@127.0.0.1:5432/${DB}`;
    const store = new PostgresActivityStore(deniedUrl);
    await assert.rejects(
      () =>
        store.append({
          id: "no-insert",
          at: new Date().toISOString(),
          computerId: "c",
          birdId: "b",
          kind: "exec",
          operation: "exec",
          success: false,
          errorCode: null,
          tenantId: "tenant-a",
          actorId: "actor",
          stage: "intent",
          metadata: { coverage: "tool" },
        }),
      (err: unknown) => storeReason(err) === "write_failed",
    );
  });

  it("rolls 0013 back to the original activity columns", async () => {
    await applySql(ROLLBACK_DB, "0012_computer_activity_events.sql");
    await applySql(ROLLBACK_DB, "0013_computer_activity_history.sql");
    const rollback = readFileSync(join(ROOT, "scripts/activity-history-rollback.sql"), "utf8");
    await withClient(ROLLBACK_DB, async (client) => {
      await client.query(rollback);
      const columns = await client.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_name = 'computer_activity_events'`,
      );
      const names = columns.rows.map((row) => String(row.column_name));
      assert.equal(names.includes("tenant_id"), false);
      assert.equal(names.includes("id"), true);
      const inserted = await client.query(
        `INSERT INTO computer_activity_events
           (id, at, computer_id, bird_id, kind, operation, success, error_code)
         VALUES ('after-rollback', now(), 'c', 'b', 'exec', 'exec', true, null)
         RETURNING id`,
      );
      assert.equal(inserted.rows[0]?.id, "after-rollback");
    });
  });
});
