/**
 * Durable desktop-session rows (nonce + revoke). HMAC still authorizes
 * across instances; this table is how close / hand-back revoke everywhere.
 */
import type { DesktopMode } from "./desktop-token";

export type DesktopSessionRow = {
  nonce: string;
  computerId: string;
  email: string;
  subject: string;
  mode: DesktopMode;
  expiresAt: number;
  revokedAt: number | null;
};

export interface DesktopSessionStore {
  save(row: DesktopSessionRow): Promise<void>;
  get(nonce: string): Promise<DesktopSessionRow | null>;
  revoke(nonce: string, now: number): Promise<boolean>;
}

export class MemoryDesktopSessionStore implements DesktopSessionStore {
  readonly rows = new Map<string, DesktopSessionRow>();

  async save(row: DesktopSessionRow): Promise<void> {
    this.rows.set(row.nonce, { ...row });
  }

  async get(nonce: string): Promise<DesktopSessionRow | null> {
    const row = this.rows.get(nonce);
    return row ? { ...row } : null;
  }

  async revoke(nonce: string, now: number): Promise<boolean> {
    const row = this.rows.get(nonce);
    if (!row || row.revokedAt !== null) return false;
    row.revokedAt = now;
    return true;
  }
}

type PgClient = {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number }>;
  end(): Promise<void>;
};

function asRow(raw: Record<string, unknown>): DesktopSessionRow | null {
  const mode = raw.mode === "control" ? "control" : raw.mode === "view" ? "view" : null;
  if (!mode) return null;
  if (
    typeof raw.nonce !== "string" ||
    typeof raw.computer_id !== "string" ||
    typeof raw.email !== "string" ||
    typeof raw.subject !== "string"
  ) {
    return null;
  }
  const expiresAt =
    raw.expires_at instanceof Date
      ? raw.expires_at.getTime()
      : typeof raw.expires_at === "string" || typeof raw.expires_at === "number"
        ? new Date(raw.expires_at).getTime()
        : NaN;
  if (!Number.isFinite(expiresAt)) return null;
  const revokedRaw = raw.revoked_at;
  const revokedAt =
    revokedRaw === null || revokedRaw === undefined
      ? null
      : revokedRaw instanceof Date
        ? revokedRaw.getTime()
        : new Date(String(revokedRaw)).getTime();
  return {
    nonce: raw.nonce,
    computerId: raw.computer_id,
    email: raw.email,
    subject: raw.subject,
    mode,
    expiresAt,
    revokedAt: revokedAt !== null && Number.isFinite(revokedAt) ? revokedAt : null,
  };
}

export class PostgresDesktopSessionStore implements DesktopSessionStore {
  constructor(private readonly databaseUrl: string) {}

  private async withClient<T>(fn: (query: PgClient["query"]) => Promise<T>): Promise<T> {
    const pg = (await import("pg")) as unknown as {
      default: { Client: new (config: { connectionString: string }) => PgClient };
    };
    const client = new pg.default.Client({ connectionString: this.databaseUrl });
    await client.connect();
    try {
      return await fn((text, values) => client.query(text, values));
    } finally {
      await client.end();
    }
  }

  async save(row: DesktopSessionRow): Promise<void> {
    await this.withClient((query) =>
      query(
        `INSERT INTO desktop_sessions (nonce, computer_id, email, subject, mode, expires_at, revoked_at)
         VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0),NULL)
         ON CONFLICT (nonce) DO NOTHING`,
        [row.nonce, row.computerId, row.email, row.subject, row.mode, row.expiresAt],
      ),
    );
  }

  async get(nonce: string): Promise<DesktopSessionRow | null> {
    const rows = await this.withClient((query) =>
      query(`SELECT nonce, computer_id, email, subject, mode, expires_at, revoked_at FROM desktop_sessions WHERE nonce = $1`, [
        nonce,
      ]),
    );
    const raw = rows.rows[0];
    return raw ? asRow(raw) : null;
  }

  async revoke(nonce: string, now: number): Promise<boolean> {
    const updated = await this.withClient((query) =>
      query(
        `UPDATE desktop_sessions
         SET revoked_at = to_timestamp($2 / 1000.0)
         WHERE nonce = $1 AND revoked_at IS NULL`,
        [nonce, now],
      ),
    );
    return (updated.rowCount ?? 0) > 0;
  }
}

const globalDesktop = globalThis as typeof globalThis & {
  __staxDesktopSessions?: DesktopSessionStore | null;
};

export function setDesktopSessionStoreForTests(store: DesktopSessionStore | null): void {
  globalDesktop.__staxDesktopSessions = store;
}

export function getDesktopSessionStore(): DesktopSessionStore {
  if (globalDesktop.__staxDesktopSessions) return globalDesktop.__staxDesktopSessions;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  globalDesktop.__staxDesktopSessions = databaseUrl
    ? new PostgresDesktopSessionStore(databaseUrl)
    : new MemoryDesktopSessionStore();
  return globalDesktop.__staxDesktopSessions;
}

export function resetDesktopSessionStoreForTests(): void {
  globalDesktop.__staxDesktopSessions = new MemoryDesktopSessionStore();
}
