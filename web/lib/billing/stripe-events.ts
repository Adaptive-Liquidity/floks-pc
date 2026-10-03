import { isUndefinedColumnError } from "./grace-schema";
import { DurableStoreRequired, requiresDurableStore } from "./seats";

export const STRIPE_EVENT_LEASE_MS = 5 * 60 * 1000;

export type StripeEventClaim = "new" | "duplicate" | "in_flight";
export type StripeEventStatus = "processing" | "done" | "failed";

export type StripeEventLease =
  | { claim: "new"; claimedAt: number | null }
  | { claim: "duplicate" }
  | { claim: "in_flight" };

export type StripeEventRow = {
  id: string;
  eventType: string;
  status: StripeEventStatus;
  claimedAt: number;
};

export interface StripeEventStore {
  claim(id: string, eventType: string, now?: number): Promise<StripeEventLease>;
  complete(id: string, claimedAt: number | null): Promise<void>;
  release(id: string, claimedAt: number | null): Promise<void>;
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

function ownsLease(row: Pick<StripeEventRow, "claimedAt">, claimedAt: number): boolean {
  return row.claimedAt === claimedAt;
}

export class MemoryStripeEventStore implements StripeEventStore {
  constructor(readonly rows: Map<string, StripeEventRow> = new Map()) {}

  async claim(id: string, eventType: string, now = Date.now()): Promise<StripeEventLease> {
    const row = this.rows.get(id);
    if (!row) {
      this.rows.set(id, { id, eventType, status: "processing", claimedAt: now });
      return { claim: "new", claimedAt: now };
    }
    if (row.status === "done") return { claim: "duplicate" };
    if (!canReclaim(row, now)) return { claim: "in_flight" };
    row.status = "processing";
    row.claimedAt = now;
    row.eventType = eventType;
    return { claim: "new", claimedAt: now };
  }

  async complete(id: string, claimedAt: number | null): Promise<void> {
    const row = this.rows.get(id);
    if (row && (claimedAt === null || ownsLease(row, claimedAt))) row.status = "done";
  }

  async release(id: string, claimedAt: number | null): Promise<void> {
    const row = this.rows.get(id);
    if (row && (claimedAt === null || ownsLease(row, claimedAt)) && row.status !== "done") {
      row.status = "failed";
    }
  }

  reset(): void {
    this.rows.clear();
  }
}

const LEASE_INSERT = `INSERT INTO stripe_events (id, event_type, status, claimed_at)
     VALUES ($1, $2, 'processing', to_timestamp($3 / 1000.0))
     ON CONFLICT (id) DO NOTHING
     RETURNING id, claimed_at`;

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
      RETURNING id, claimed_at`;

const LEASE_COMPLETE = `UPDATE stripe_events
        SET status = 'done'
      WHERE id = $1 AND claimed_at = to_timestamp($2 / 1000.0)`;

const COMPLETE_BY_ID = `UPDATE stripe_events SET status = 'done' WHERE id = $1`;

const LEASE_RELEASE = `UPDATE stripe_events
        SET status = 'failed'
      WHERE id = $1 AND (
        (claimed_at = to_timestamp($2 / 1000.0) AND status <> 'done')
        OR claimed_at IS NULL
      )`;

const RELEASE_BY_ID = `UPDATE stripe_events SET status = 'failed' WHERE id = $1`;

const PRE_LEASE_DELETE = `DELETE FROM stripe_events WHERE id = $1`;

export class PostgresStripeEventStore implements StripeEventStore {
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

  async claim(id: string, eventType: string, now = Date.now()): Promise<StripeEventLease> {
    try {
      const inserted = await this.rawQuery<{ id: string; claimed_at?: Date | string }>(LEASE_INSERT, [
        id,
        eventType,
        now,
      ]);
      if (inserted.rows.length > 0) return { claim: "new", claimedAt: now };
      const found = await this.rawQuery<{
        id: string;
        event_type?: string;
        status?: string;
        claimed_at?: Date | string;
      }>(LEASE_SELECT, [id]);
      const row = found.rows[0];
      if (!row) return this.claimPre0010(id, eventType, now);
      if (row.status === "done") return { claim: "duplicate" };
      const claimedAt = row.claimed_at ? new Date(row.claimed_at).getTime() : 0;
      if (row.status === "processing" && now - claimedAt < STRIPE_EVENT_LEASE_MS) {
        return { claim: "in_flight" };
      }
      const reclaimed = await this.rawQuery<{ id: string }>(LEASE_RECLAIM, [
        id,
        eventType,
        now,
        now - STRIPE_EVENT_LEASE_MS,
      ]);
      return reclaimed.rows.length > 0 ? { claim: "new", claimedAt: now } : { claim: "in_flight" };
    } catch (err) {
      if (!isUndefinedColumnError(err)) throw err;
      return this.claimPre0010(id, eventType, now);
    }
  }

  async claimPre0010(id: string, eventType: string, _now = Date.now()): Promise<StripeEventLease> {
    const inserted = await this.rawQuery<{ id: string }>(PRE_LEASE_INSERT, [id, eventType]);
    return inserted.rows.length > 0 ? { claim: "new", claimedAt: null } : { claim: "duplicate" };
  }

  async complete(id: string, claimedAt: number | null): Promise<void> {
    try {
      if (claimedAt === null) await this.rawQuery(COMPLETE_BY_ID, [id]);
      else await this.rawQuery(LEASE_COMPLETE, [id, claimedAt]);
    } catch (err) {
      if (!isUndefinedColumnError(err)) throw err;
    }
  }

  async release(id: string, claimedAt: number | null): Promise<void> {
    try {
      if (claimedAt === null) await this.rawQuery(RELEASE_BY_ID, [id]);
      else await this.rawQuery(LEASE_RELEASE, [id, claimedAt]);
    } catch (err) {
      if (!isUndefinedColumnError(err)) throw err;
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
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (requiresDurableStore() && !databaseUrl) {
    throw new DurableStoreRequired(
      "DATABASE_URL is required to claim Stripe events on Vercel and in production. In-memory event ids are not shared across instances.",
    );
  }
  if (globalEvents.__staxStripeEvents) return globalEvents.__staxStripeEvents;
  if (databaseUrl) {
    globalEvents.__staxStripeEvents = new PostgresStripeEventStore(databaseUrl);
    return globalEvents.__staxStripeEvents;
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
): Promise<StripeEventLease> {
  return getStripeEventStore().claim(id, eventType, now);
}

export async function completeStripeEvent(id: string, claimedAt: number | null): Promise<void> {
  await getStripeEventStore().complete(id, claimedAt);
}

export async function releaseStripeEvent(id: string, claimedAt: number | null): Promise<void> {
  await getStripeEventStore().release(id, claimedAt);
}
