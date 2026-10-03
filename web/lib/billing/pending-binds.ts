import { flockIdForEmail } from "../desks/runtime";
import { normalizeEmail } from "./plans";
import { getSeatStore } from "./seats";
import type { CheckoutPlanId } from "./catalog";

export type PendingBind = {
  nonce: string;
  clientId: string;
  subject: string;
  flock: string;
  plan: CheckoutPlanId;
  email: string;
  expiresAt: number;
  openedAt: number | null;
  usedAt: number | null;
  failedAt: number | null;
  failReason: string | null;
};

export type PendingBindClaim = "ok" | "used" | "expired" | "missing";

export interface PendingBindStore {
  save(row: PendingBind): Promise<void>;
  get(nonce: string): Promise<PendingBind | null>;
  listByEmail(email: string): Promise<PendingBind[]>;
  listOpenByEmail(email: string, now?: number): Promise<PendingBind[]>;
  claimOpen(nonce: string, now: number): Promise<PendingBindClaim>;
  markUsed(nonce: string, now?: number): Promise<boolean>;
  markFailed(nonce: string, reason: string, now?: number): Promise<boolean>;
}

function isOpenPending(row: PendingBind, now: number): boolean {
  if (row.usedAt !== null) return false;
  if (row.openedAt !== null) return true;
  return row.expiresAt > now;
}

export class MemoryPendingBindStore implements PendingBindStore {
  readonly rows = new Map<string, PendingBind>();

  async save(row: PendingBind): Promise<void> {
    this.rows.set(row.nonce, {
      ...row,
      failedAt: row.failedAt ?? null,
      failReason: row.failReason ?? null,
    });
  }
  async get(nonce: string): Promise<PendingBind | null> {
    const row = this.rows.get(nonce);
    return row ? { ...row } : null;
  }
  async listByEmail(email: string): Promise<PendingBind[]> {
    const key = normalizeEmail(email);
    return [...this.rows.values()].filter((row) => row.email === key).map((row) => ({ ...row }));
  }
  async listOpenByEmail(email: string, now = Date.now()): Promise<PendingBind[]> {
    const key = normalizeEmail(email);
    return [...this.rows.values()]
      .filter((row) => row.email === key && isOpenPending(row, now))
      .map((row) => ({ ...row }));
  }
  async claimOpen(nonce: string, now: number): Promise<PendingBindClaim> {
    const row = this.rows.get(nonce);
    if (!row) return "missing";
    if (row.usedAt !== null || row.openedAt !== null) return "used";
    if (row.expiresAt <= now) return "expired";
    row.openedAt = now;
    return "ok";
  }
  async markUsed(nonce: string, now = Date.now()): Promise<boolean> {
    const row = this.rows.get(nonce);
    if (!row || row.usedAt !== null) return false;
    row.usedAt = now;
    return true;
  }
  async markFailed(nonce: string, reason: string, now = Date.now()): Promise<boolean> {
    const row = this.rows.get(nonce);
    if (!row) return false;
    row.usedAt = row.usedAt ?? now;
    row.failedAt = now;
    row.failReason = reason;
    return true;
  }
}

type PgClient = {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
};

export class PostgresPendingBindStore implements PendingBindStore {
  private readonly failures = new Map<string, { reason: string; at: number }>();

  constructor(private readonly databaseUrl: string) {}

  private withFailure(row: PendingBind | null): PendingBind | null {
    if (!row) return null;
    const fail = this.failures.get(row.nonce);
    if (!fail) return row;
    return { ...row, failedAt: fail.at, failReason: fail.reason };
  }

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

  async save(row: PendingBind): Promise<void> {
    await this.withClient((query) =>
      query(
        `INSERT INTO pending_binds (nonce, client_id, subject, flock, plan, email, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7 / 1000.0))
         ON CONFLICT (nonce) DO NOTHING`,
        [row.nonce, row.clientId, row.subject, row.flock, row.plan, row.email, row.expiresAt],
      ),
    );
  }

  async get(nonce: string): Promise<PendingBind | null> {
    const result = await this.withClient((query) => query(`SELECT * FROM pending_binds WHERE nonce = $1`, [nonce]));
    return this.withFailure(mapBind(result.rows[0]));
  }

  async listByEmail(email: string): Promise<PendingBind[]> {
    const result = await this.withClient((query) =>
      query(`SELECT * FROM pending_binds WHERE email = $1`, [normalizeEmail(email)]),
    );
    return result.rows
      .map((row) => this.withFailure(mapBind(row)))
      .filter((row): row is PendingBind => row !== null);
  }

  async listOpenByEmail(email: string, now = Date.now()): Promise<PendingBind[]> {
    const result = await this.withClient((query) =>
      query(
        `SELECT * FROM pending_binds
          WHERE email = $1
            AND used_at IS NULL
            AND (opened_at IS NOT NULL OR expires_at > to_timestamp($2 / 1000.0))`,
        [normalizeEmail(email), now],
      ),
    );
    return result.rows
      .map((row) => this.withFailure(mapBind(row)))
      .filter((row): row is PendingBind => row !== null);
  }

  async claimOpen(nonce: string, now: number): Promise<PendingBindClaim> {
    const claimed = await this.withClient((query) =>
      query(
        `UPDATE pending_binds SET opened_at = to_timestamp($2 / 1000.0)
         WHERE nonce = $1 AND opened_at IS NULL AND used_at IS NULL AND expires_at > to_timestamp($2 / 1000.0)
         RETURNING nonce`,
        [nonce, now],
      ),
    );
    if (claimed.rows.length > 0) return "ok";
    const row = await this.get(nonce);
    if (!row) return "missing";
    if (row.usedAt !== null || row.openedAt !== null) return "used";
    return "expired";
  }

  async markUsed(nonce: string, now = Date.now()): Promise<boolean> {
    const result = await this.withClient((query) =>
      query(
        `UPDATE pending_binds SET used_at = to_timestamp($2 / 1000.0)
         WHERE nonce = $1 AND used_at IS NULL
         RETURNING nonce`,
        [nonce, now],
      ),
    );
    return result.rows.length > 0;
  }

  async markFailed(nonce: string, reason: string, now = Date.now()): Promise<boolean> {
    const marked = await this.markUsed(nonce, now);
    const row = await this.get(nonce);
    if (!row) return false;
    this.failures.set(nonce, { reason, at: now });
    return marked || Boolean(row.usedAt);
  }
}

function mapBind(row: Record<string, unknown> | undefined): PendingBind | null {
  if (!row) return null;
  const plan = String(row.plan);
  if (plan !== "personal" && plan !== "pro" && plan !== "team") return null;
  return {
    nonce: String(row.nonce),
    clientId: String(row.client_id),
    subject: String(row.subject),
    flock: String(row.flock),
    plan,
    email: String(row.email),
    expiresAt: new Date(String(row.expires_at)).getTime(),
    openedAt: row.opened_at ? new Date(String(row.opened_at)).getTime() : null,
    usedAt: row.used_at ? new Date(String(row.used_at)).getTime() : null,
    failedAt: row.failed_at ? new Date(String(row.failed_at)).getTime() : null,
    failReason: typeof row.fail_reason === "string" ? row.fail_reason : null,
  };
}

const globalBinds = globalThis as typeof globalThis & { __staxPendingBinds?: PendingBindStore };

export function setPendingBindStoreForTests(next: PendingBindStore | null): void {
  if (next) globalBinds.__staxPendingBinds = next;
  else delete globalBinds.__staxPendingBinds;
}

export function getPendingBindStore(): PendingBindStore {
  if (globalBinds.__staxPendingBinds) return globalBinds.__staxPendingBinds;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  globalBinds.__staxPendingBinds = databaseUrl
    ? new PostgresPendingBindStore(databaseUrl)
    : new MemoryPendingBindStore();
  return globalBinds.__staxPendingBinds;
}

export async function activeComputerIdsForEmail(email: string): Promise<string[]> {
  const seats = await getSeatStore().listByEmail(email);
  return computerIdsFrom(seats.filter((seat) => seat.status === "active"));
}

export async function activeComputerIdsForFlock(flock: string): Promise<string[]> {
  const seats = await getSeatStore().listAll();
  return computerIdsFrom(
    seats.filter((seat) => seat.status === "active" && flockIdForEmail(seat.email) === flock),
  );
}

function computerIdsFrom(seats: Array<{ computerId: string | null; computerIds: string[] }>): string[] {
  const ids: string[] = [];
  for (const seat of seats) {
    for (const id of seat.computerIds) {
      if (id && !ids.includes(id)) ids.push(id);
    }
    if (seat.computerId && !ids.includes(seat.computerId)) ids.push(seat.computerId);
  }
  return ids;
}
