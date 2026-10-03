import {
  ACTIVITY_PAGE_MAX,
  ACTIVITY_RETENTION_MS,
  ACTIVITY_VISIBLE_STAGES,
  ActivityEventSchema,
  ActivityStoreError,
  DASHBOARD_EVENT_KINDS,
  activityFailureReason,
  decodeActivityCursor,
  encodeActivityCursor,
  type ActivityEvent,
  type ActivityListOptions,
  type ActivityMetadata,
  type ActivityOutcome,
  type ActivityPage,
  type ActivityStage,
  type ActivityStore,
} from "../../../src/lib/computers/index";

type PgClient = {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
  end(): Promise<void>;
};

export class PostgresActivityStore implements ActivityStore {
  constructor(private readonly databaseUrl: string) {}

  private async withClient<T>(
    tenantId: string | null,
    fn: (client: PgClient) => Promise<T>,
  ): Promise<T> {
    const pg = await import("pg");
    const client = new pg.default.Client({ connectionString: this.databaseUrl }) as unknown as PgClient;
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('staxions.tenant_id', $1, true)", [tenantId ?? ""]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw mapActivityWriteError(err);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async append(event: ActivityEvent): Promise<void> {
    const parsed = ActivityEventSchema.parse(event);
    await this.withClient(parsed.tenantId ?? null, async (client) => {
      await client.query(
        `INSERT INTO computer_activity_events
           (id, at, computer_id, bird_id, kind, operation, success, error_code,
            tenant_id, actor_id, owner_id, request_id, operation_id, attempt_id,
            stage, outcome, recorded_at, coverage, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                 $9, $10, $11, $12, $13, $14,
                 $15, $16, $17, $18, $19::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [
          parsed.id,
          parsed.at,
          parsed.computerId,
          parsed.birdId,
          parsed.kind,
          parsed.operation,
          parsed.success,
          parsed.errorCode,
          parsed.tenantId ?? null,
          parsed.actorId ?? null,
          parsed.ownerId ?? null,
          parsed.requestId ?? null,
          parsed.operationId ?? null,
          parsed.attemptId ?? null,
          parsed.stage ?? null,
          parsed.outcome ?? null,
          parsed.recordedAt ?? parsed.at,
          parsed.metadata?.coverage ?? (parsed.stage ? "tool" : null),
          parsed.metadata ? JSON.stringify(parsed.metadata) : null,
        ],
      );
    });
  }

  async list(computerId: string, opts: ActivityListOptions): Promise<ActivityPage> {
    const limit = Math.min(ACTIVITY_PAGE_MAX, Math.max(1, opts.limit));
    const kinds = opts.kinds ?? DASHBOARD_EVENT_KINDS;
    const nowMs = opts.nowMs ?? Date.now();
    const cutoff = new Date(nowMs - ACTIVITY_RETENTION_MS).toISOString();
    const cursor = opts.cursor ? decodeActivityCursor(opts.cursor) : null;
    const values: unknown[] = [computerId, kinds, cutoff, [...ACTIVITY_VISIBLE_STAGES]];
    let where = `computer_id = $1
      AND kind = ANY($2::text[])
      AND at >= $3::timestamptz
      AND (stage IS NULL OR stage = ANY($4::text[]))`;
    if (opts.tenantId) {
      values.push(opts.tenantId);
      where += ` AND (tenant_id IS NULL OR tenant_id = $${values.length})`;
    }
    if (cursor) {
      values.push(cursor.at, cursor.id);
      const atPos = values.length - 1;
      const idPos = values.length;
      where += ` AND (at, id) < ($${atPos}::timestamptz, $${idPos})`;
    }
    const rows = await this.withClient(opts.tenantId ?? null, async (client) => {
      const result = await client.query(
        `SELECT id, at, computer_id, bird_id, kind, operation, success, error_code,
                tenant_id, actor_id, owner_id, request_id, operation_id, attempt_id,
                stage, outcome, recorded_at, coverage, metadata
           FROM computer_activity_events
          WHERE ${where}
          ORDER BY at DESC, id DESC
          LIMIT ${limit + 1}`,
        values,
      );
      return result.rows as ActivityRow[];
    });
    const parsed: ActivityEvent[] = [];
    for (const row of rows) {
      const event = ActivityEventSchema.safeParse(rowToEvent(row));
      if (event.success) parsed.push(event.data);
    }
    const extra = parsed.length > limit;
    const events = extra ? parsed.slice(0, limit) : parsed;
    const last = events[events.length - 1];
    return {
      events,
      nextCursor: extra && last ? encodeActivityCursor(last.at, last.id) : null,
    };
  }

  async purgeExpired(nowMs: number): Promise<number> {
    const cutoff = new Date(nowMs).toISOString();
    const rows = await this.withClient(null, async (client) => {
      const result = await client.query(
        `SELECT staxions_purge_activity_history($1::timestamptz)::text AS count`,
        [cutoff],
      );
      return result.rows as Array<{ count: string }>;
    });
    return Number(rows[0]?.count ?? 0) || 0;
  }
}

type ActivityRow = {
  id: string;
  at: Date | string;
  computer_id: string | null;
  bird_id: string | null;
  kind: string;
  operation: string;
  success: boolean;
  error_code: string | null;
  tenant_id: string | null;
  actor_id: string | null;
  owner_id: string | null;
  request_id: string | null;
  operation_id: string | null;
  attempt_id: string | null;
  stage: string | null;
  outcome: string | null;
  recorded_at: Date | string | null;
  coverage: string | null;
  metadata: ActivityMetadata | null;
};

function iso(value: Date | string | null | undefined): string | undefined {
  if (value == null) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowToEvent(row: ActivityRow): Record<string, unknown> {
  const at = iso(row.at) ?? new Date(0).toISOString();
  const recordedAt = iso(row.recorded_at);
  return {
    id: row.id,
    at,
    computerId: row.computer_id,
    birdId: row.bird_id,
    kind: row.kind,
    operation: row.operation,
    success: row.success,
    errorCode: row.error_code,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    ownerId: row.owner_id,
    requestId: row.request_id,
    operationId: row.operation_id,
    attemptId: row.attempt_id,
    stage: row.stage as ActivityStage | null,
    outcome: row.outcome as ActivityOutcome | null,
    ...(recordedAt ? { recordedAt } : {}),
    ...(row.metadata && typeof row.metadata === "object" ? { metadata: row.metadata } : {}),
  };
}

function mapActivityWriteError(err: unknown): Error {
  if (err instanceof ActivityStoreError) return err;
  const reason = activityFailureReason(err);
  if (reason === "missing_table") {
    return new ActivityStoreError("missing_table", "Activity history table is missing.");
  }
  if (reason === "missing_column") {
    return new ActivityStoreError("missing_column", "Activity history columns are missing.");
  }
  return new ActivityStoreError("write_failed", "Activity history write failed.");
}
