import {
  ACTIVITY_PAGE_MAX,
  ACTIVITY_RETENTION_MS,
  ActivityEventSchema,
  DASHBOARD_EVENT_KINDS,
  decodeActivityCursor,
  encodeActivityCursor,
  type ActivityEvent,
  type ActivityListOptions,
  type ActivityPage,
  type ActivityStore,
} from "../../../src/lib/computers/index";

export class PostgresActivityStore implements ActivityStore {
  constructor(private readonly databaseUrl: string) {}

  private async query<T>(text: string, values: unknown[]): Promise<T[] | null> {
    const pg = await import("pg");
    const client = new pg.default.Client({ connectionString: this.databaseUrl });
    try {
      await client.connect();
      const result = await client.query(text, values);
      return result.rows as T[];
    } catch (err) {
      if (isMissingRelation(err)) return null;
      throw err;
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async append(event: ActivityEvent): Promise<void> {
    const parsed = ActivityEventSchema.parse(event);
    await this.query(
      `INSERT INTO computer_activity_events
         (id, at, computer_id, bird_id, kind, operation, success, error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
      ],
    );
  }

  async list(computerId: string, opts: ActivityListOptions): Promise<ActivityPage> {
    const limit = Math.min(ACTIVITY_PAGE_MAX, Math.max(1, opts.limit));
    const kinds = opts.kinds ?? DASHBOARD_EVENT_KINDS;
    const nowMs = opts.nowMs ?? Date.now();
    const cutoff = new Date(nowMs - ACTIVITY_RETENTION_MS).toISOString();
    const cursor = opts.cursor ? decodeActivityCursor(opts.cursor) : null;
    const values: unknown[] = [computerId, kinds, cutoff];
    let where = `computer_id = $1 AND kind = ANY($2::text[]) AND at >= $3::timestamptz`;
    if (cursor) {
      values.push(cursor.at, cursor.id);
      where += ` AND (at, id) < ($4::timestamptz, $5)`;
    }
    const rows = await this.query<{
      id: string;
      at: Date | string;
      computer_id: string | null;
      bird_id: string | null;
      kind: string;
      operation: string;
      success: boolean;
      error_code: string | null;
    }>(
      `SELECT id, at, computer_id, bird_id, kind, operation, success, error_code
         FROM computer_activity_events
        WHERE ${where}
        ORDER BY at DESC, id DESC
        LIMIT ${limit + 1}`,
      values,
    );
    if (!rows) return { events: [], nextCursor: null };
    const parsed: ActivityEvent[] = [];
    for (const row of rows) {
      const at = row.at instanceof Date ? row.at.toISOString() : String(row.at);
      const event = ActivityEventSchema.safeParse({
        id: row.id,
        at,
        computerId: row.computer_id,
        birdId: row.bird_id,
        kind: row.kind,
        operation: row.operation,
        success: row.success,
        errorCode: row.error_code,
      });
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
    const cutoff = new Date(nowMs - ACTIVITY_RETENTION_MS).toISOString();
    const rows = await this.query<{ count: string }>(
      `WITH gone AS (
         DELETE FROM computer_activity_events
          WHERE at < $1::timestamptz
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM gone`,
      [cutoff],
    );
    if (!rows?.[0]?.count) return 0;
    return Number(rows[0].count) || 0;
  }
}

function isMissingRelation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? err.code : null;
  return code === "42P01";
}
