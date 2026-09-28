import {
  ControlPlaneSnapshotSchema,
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
