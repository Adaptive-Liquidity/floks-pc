import {
  ControlPlaneSnapshotSchema,
  StaleControlPlane,
  assertSnapshotHasNoRawSecrets,
  type ControlPlaneSnapshot,
  type ControlPlaneStore,
} from "../../../src/lib/computers/index";

const DEFAULT_ID = "default";

export class PostgresControlPlaneStore implements ControlPlaneStore {
  constructor(
    private readonly databaseUrl: string,
    private readonly id = DEFAULT_ID,
  ) {}

  private async query<T>(text: string, values: unknown[]): Promise<T[]> {
    const pg = await import("pg");
    const client = new pg.default.Client({ connectionString: this.databaseUrl });
    await client.connect();
    try {
      const result = await client.query(text, values);
      return result.rows as T[];
    } finally {
      await client.end();
    }
  }

  async load(): Promise<ControlPlaneSnapshot | null> {
    const rows = await this.query<{ snapshot: unknown }>(
      `SELECT snapshot FROM control_plane_snapshots WHERE id = $1`,
      [this.id],
    );
    const raw = rows[0]?.snapshot;
    if (!raw) return null;
    return ControlPlaneSnapshotSchema.parse(raw);
  }

  async currentRevision(): Promise<number> {
    const rows = await this.query<{ revision: number }>(
      `SELECT revision FROM control_plane_snapshots WHERE id = $1`,
      [this.id],
    );
    return Number(rows[0]?.revision ?? 0);
  }

  async compareAndSave(snapshot: ControlPlaneSnapshot, expectedRevision: number): Promise<number> {
    const parsed = ControlPlaneSnapshotSchema.parse(snapshot);
    assertSnapshotHasNoRawSecrets(parsed);
    const pg = await import("pg");
    const client = new pg.default.Client({ connectionString: this.databaseUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ revision: string }>(
        `SELECT revision FROM control_plane_snapshots WHERE id = $1 FOR UPDATE`,
        [this.id],
      );
      if (locked.rows.length === 0) {
        if (expectedRevision !== 0) {
          await client.query("ROLLBACK");
          throw new StaleControlPlane();
        }
        await client.query(
          `INSERT INTO control_plane_snapshots (id, snapshot, revision, updated_at)
           VALUES ($1, $2::jsonb, 1, NOW())`,
          [this.id, JSON.stringify(parsed)],
        );
        await client.query("COMMIT");
        return 1;
      }
      const current = Number(locked.rows[0]?.revision ?? 0);
      if (current !== expectedRevision) {
        await client.query("ROLLBACK");
        throw new StaleControlPlane();
      }
      await client.query(
        `UPDATE control_plane_snapshots
         SET snapshot = $2::jsonb, revision = revision + 1, updated_at = NOW()
         WHERE id = $1 AND revision = $3`,
        [this.id, JSON.stringify(parsed), expectedRevision],
      );
      await client.query("COMMIT");
      return expectedRevision + 1;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* already closed */
      }
      throw err;
    } finally {
      await client.end();
    }
  }

  async save(snapshot: ControlPlaneSnapshot): Promise<void> {
    const parsed = ControlPlaneSnapshotSchema.parse(snapshot);
    assertSnapshotHasNoRawSecrets(parsed);
    await this.query(
      `INSERT INTO control_plane_snapshots (id, snapshot, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = NOW()`,
      [this.id, JSON.stringify(parsed)],
    );
  }
}

export function webControlPlaneStore(
  env: NodeJS.ProcessEnv,
  providerName: string,
): ControlPlaneStore | undefined {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) return new PostgresControlPlaneStore(databaseUrl);
  const durable =
    env.NODE_ENV === "production" || env.VERCEL === "1" || env.VERCEL_ENV === "production";
  if (durable && providerName === "runloop") {
    throw new Error(
      "DATABASE_URL is required for the computer control plane on Vercel/production. File/memory stores are local-dev only.",
    );
  }
  return undefined;
}
