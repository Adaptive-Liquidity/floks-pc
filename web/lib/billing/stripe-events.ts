import { isUndefinedColumnError } from "./grace-schema";
import { DurableStoreRequired, requiresDurableStore } from "./seats";

export const STRIPE_EVENT_LEASE_MS = 5 * 60 * 1000;

export type StripeEventClaim = "new" | "duplicate" | "in_flight";
export type StripeEventStatus = "processing" | "done" | "failed";

export type StripeEventRow = {
  id: string;
  eventType: string;
  status: StripeEventStatus;
  claimedAt: number;
};

export interface StripeEventStore {
  claim(id: string, eventType: string, now?: number): Promise<StripeEventClaim>;
  complete(id: string): Promise<void>;
  release(id: string): Promise<void>;
}

export type StripeEventSqlQuery = <T>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[] }>;

function canReclaim(row: Pick<StripeEventRow, "status" | "claimedAt">, now: number): boolean {
  if (row.status === "done") return false;
  if (row.status === "failed") return true;
  return now - row.claimedAt >= STRIPE_EVENT_LEASE_MS;
}

export class MemoryStripeEventStore implements StripeEventStore {
  constructor(readonly rows: Map<string, StripeEventRow> = new Map()) {}

  async claim(id: string, eventType: string, now = Date.now()): Promise<StripeEventClaim> {
    const row = this.rows.get(id);
    if (!row) {
      this.rows.set(id, { id, eventType, status: "processing", claimedAt: now });
      return "new";
    }
    if (row.status === "done") return "duplicate";
    if (!canReclaim(row, now)) return "in_flight";
    row.status = "processing";
    row.claimedAt = now;
    row.eventType = eventType;
    return "new";
  }

  async complete(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.status = "done";
  }

  async release(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row && row.status !== "done") row.status = "failed";
  }

  reset(): void {
    this.rows.clear();
  }
}

const LEASE_INSERT = `INSERT INTO stripe_events (id, event_type, status, claimed_at)
     VALUES ($1, $2, 'processing', to_timestamp($3 / 1000.0))
     ON CONFLICT (id) DO NOTHING
     RETURNING id`;

const PRE_LEASE_INSERT = `INSERT INTO stripe_events (id, event_type) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`;

const LEASE_SELECT = `SELECT id, event_type, status, claimed_at FROM stripe_events WHERE id = $1`;

const LEASE_RECLAIM = `UPDATE stripe_events
        SET status = 'processing',
            event_type = $2,
            claimed_at = to_timestamp($3 / 1000.0)
      WHERE id = $1
        AND (
          status = 'failed'
          OR (status = 'processing' AND claimed_at <= to_timestamp($4 / 1000.0))
        )
      RETURNING id`;

const LEASE_COMPLETE = `UPDATE stripe_events SET status = 'done' WHERE id = $1`;
const LEASE_RELEASE = `UPDATE stripe_events SET status = 'failed' WHERE id = $1 AND status <> 'done'`;
const PRE_LEASE_DELETE = `DELETE FROM stripe_events WHERE id = $1`;

export class PostgresStripeEventStore implements StripeEventStore {
  private leaseColumns: boolean | null = null;
  private leaseProbedAt = 0;

  constructor(
    private readonly databaseUrl: string,
    private readonly injectedQuery?: StripeEventSqlQuery,
  ) {}

  private async rawQuery<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }> {
    if (this.injectedQuery) return this.injectedQuery<T>(text, values);
    const pg = await import("pg");
    const client = new pg.default.Client({ connectionString: this.databaseUrl });
    await client.connect();
    try {
      const result = await client.query(text, values);
      return { rows: result.rows as T[] };
    } finally {
      await client.end();
    }
  }

  private leaseProbeIsStale(now: number): boolean {
    if (this.leaseColumns === true) return false;
    if (this.leaseColumns === null) return true;
    return now - this.leaseProbedAt >= 60_000;
  }

  private markLease(ready: boolean, now: number): void {
    this.leaseColumns = ready;
    this.leaseProbedAt = now;
  }

  async claim(id: string, eventType: string, now = Date.now()): Promise<StripeEventClaim> {
    if (this.leaseColumns === false && !this.leaseProbeIsStale(now)) {
      return this.claimPre0010(id, eventType);
    }
    try {
      const inserted = await this.rawQuery<{ id: string }>(LEASE_INSERT, [id, eventType, now]);
      this.markLease(true, now);
      if (inserted.rows.length > 0) return "new";
      const found = await this.rawQuery<{
        id: string;
        event_type?: string;
        status?: string;
        claimed_at?: Date | string;
      }>(LEASE_SELECT, [id]);
      const row = found.rows[0];
      if (!row) return this.claimPre0010(id, eventType);
      if (row.status === "done") return "duplicate";
      const claimedAt = row.claimed_at ? new Date(row.claimed_at).getTime() : 0;
      if (row.status === "processing" && now - claimedAt < STRIPE_EVENT_LEASE_MS) {
        return "in_flight";
      }
      const reclaimed = await this.rawQuery<{ id: string }>(LEASE_RECLAIM, [
        id,
        eventType,
        now,
        now - STRIPE_EVENT_LEASE_MS,
      ]);
      return reclaimed.rows.length > 0 ? "new" : "in_flight";
    } catch (err) {
      if (!isUndefinedColumnError(err)) throw err;
      this.markLease(false, now);
      return this.claimPre0010(id, eventType);
    }
  }

  private async claimPre0010(id: string, eventType: string): Promise<StripeEventClaim> {
    const inserted = await this.rawQuery<{ id: string }>(PRE_LEASE_INSERT, [id, eventType]);
    return inserted.rows.length > 0 ? "new" : "duplicate";
  }

  async complete(id: string): Promise<void> {
    if (this.leaseColumns === false) return;
    try {
      await this.rawQuery(LEASE_COMPLETE, [id]);
      this.markLease(true, Date.now());
    } catch (err) {
      if (!isUndefinedColumnError(err)) throw err;
      this.markLease(false, Date.now());
    }
  }

  async release(id: string): Promise<void> {
    if (this.leaseColumns === false) {
      await this.rawQuery(PRE_LEASE_DELETE, [id]);
      return;
    }
    try {
      await this.rawQuery(LEASE_RELEASE, [id]);
      this.markLease(true, Date.now());
    } catch (err) {
      if (!isUndefinedColumnError(err)) throw err;
      this.markLease(false, Date.now());
      await this.rawQuery(PRE_LEASE_DELETE, [id]);
    }
  }
}

const globalEvents = globalThis as typeof globalThis & {
  __staxStripeEvents?: StripeEventStore;
  __staxStripeEventMemory?: MemoryStripeEventStore;
};

function sharedMemory(): MemoryStripeEventStore {
  if (!globalEvents.__staxStripeEventMemory) {
    globalEvents.__staxStripeEventMemory = new MemoryStripeEventStore();
  }
  return globalEvents.__staxStripeEventMemory;
}

export function getStripeEventStore(): StripeEventStore {
  if (globalEvents.__staxStripeEvents) return globalEvents.__staxStripeEvents;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    globalEvents.__staxStripeEvents = new PostgresStripeEventStore(databaseUrl);
    return globalEvents.__staxStripeEvents;
  }
  if (requiresDurableStore()) {
    throw new DurableStoreRequired(
      "DATABASE_URL is required to claim Stripe events on Vercel and in production. In-memory event ids are not shared across instances.",
    );
  }
  globalEvents.__staxStripeEvents = sharedMemory();
  return globalEvents.__staxStripeEvents;
}

export function setStripeEventStoreForTests(store: StripeEventStore | null): void {
  if (store) globalEvents.__staxStripeEvents = store;
  else delete globalEvents.__staxStripeEvents;
}

export function resetStripeEventsForTests(): void {
  sharedMemory().reset();
  globalEvents.__staxStripeEvents = sharedMemory();
}

export async function claimStripeEvent(
  id: string,
  eventType: string,
  now = Date.now(),
): Promise<StripeEventClaim> {
  return getStripeEventStore().claim(id, eventType, now);
}

export async function completeStripeEvent(id: string): Promise<void> {
  await getStripeEventStore().complete(id);
}

export async function releaseStripeEvent(id: string): Promise<void> {
  await getStripeEventStore().release(id);
}
