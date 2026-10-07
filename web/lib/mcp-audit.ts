import { randomUUID } from "node:crypto";
import { redactValue } from "../../src/lib/mcp/log";

/** Metadata only. No command output, tokens, or screenshots. */
export type McpAuditRow = {
  id: string;
  computerId: string | null;
  birdId: string | null;
  operation: string;
  targetClass: string | null;
  startedAt: string;
  finishedAt: string | null;
  success: boolean;
  errorCode: string | null;
  traceId: string | null;
  receiptId: string | null;
};

export type McpAuditSink = (row: McpAuditRow) => void | Promise<void>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value !== "[redacted]" ? value : null;
}

/** Public error codes are short. A long token in `code` is dropped. */
function publicCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64 || /[A-Za-z0-9_-]{32,}/u.test(trimmed)) return null;
  return trimmed;
}

/** Build one audit row from an already-redacted log call. Extra fields are dropped. */
export function mcpAuditRow(
  level: "info" | "warn" | "error",
  event: string,
  fields?: Record<string, unknown>,
  now: Date = new Date(),
): McpAuditRow {
  const redacted = (fields ? redactValue(fields) : {}) as Record<string, unknown>;
  const code = publicCode(fields?.code);
  const stamp = now.toISOString();
  return {
    id: randomUUID(),
    computerId: text(redacted.computer_id) ?? text(redacted.computerId),
    birdId: text(redacted.bird_id) ?? text(redacted.birdId),
    operation: event,
    targetClass: text(redacted.name),
    startedAt: stamp,
    finishedAt: stamp,
    success: level === "info" && code === null,
    errorCode: code ?? (level === "info" ? null : level),
    traceId: text(redacted.instance),
    receiptId: null,
  };
}

function isMissingRelation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? err.code : null;
  return code === "42P01";
}

/**
 * Insert one row. A missing table (the migration is not applied yet) is ignored.
 * Other database errors are not hidden, and the connection string is not logged.
 */
export function postgresMcpAuditSink(env: NodeJS.ProcessEnv = process.env): McpAuditSink {
  return async (row) => {
    const databaseUrl = env.DATABASE_URL?.trim();
    if (!databaseUrl) return;
    const pg = await import("pg");
    const client = new pg.default.Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query(
        `INSERT INTO computer_audit_events
           (id, computer_id, bird_id, operation, target_class, started_at, finished_at, success, error_code, trace_id, receipt_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.computerId,
          row.birdId,
          row.operation,
          row.targetClass,
          row.startedAt,
          row.finishedAt,
          row.success,
          row.errorCode,
          row.traceId,
          row.receiptId,
        ],
      );
    } catch (err) {
      if (isMissingRelation(err)) return;
      throw err;
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
