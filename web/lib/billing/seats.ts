import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { hoursForPlan, normalizeEmail } from "./plans";
import type { PlanId } from "../types";

export type SeatStatus = "active" | "past_due" | "canceled";

export type SeatRecord = {
  id: string;
  email: string;
  plan: PlanId;
  status: SeatStatus;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripeCheckoutSessionId: string | null;
  hoursIncluded: number;
  hoursUsed: number;
  periodStart: string | null;
  periodEnd: string | null;
  computerId: string | null;
  createdAt: string;
  updatedAt: string;
};

export interface SeatStore {
  listByEmail(email: string): Promise<SeatRecord[]>;
  getById(id: string): Promise<SeatRecord | null>;
  getByCheckoutSession(id: string): Promise<SeatRecord | null>;
  getBySubscription(id: string): Promise<SeatRecord | null>;
  upsert(seat: SeatRecord): Promise<SeatRecord>;
}

export function newSeatId(): string {
  return randomBytes(16).toString("hex");
}

export function createSeat(input: {
  email: string;
  plan: PlanId;
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  stripeCheckoutSessionId?: string | null;
  status?: SeatStatus;
  hoursUsed?: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  computerId?: string | null;
}): SeatRecord {
  const now = new Date().toISOString();
  return {
    id: newSeatId(),
    email: normalizeEmail(input.email),
    plan: input.plan,
    status: input.status ?? "active",
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId ?? null,
    stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? null,
    hoursIncluded: hoursForPlan(input.plan),
    hoursUsed: input.hoursUsed ?? 0,
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    computerId: input.computerId ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export class MemorySeatStore implements SeatStore {
  private rows = new Map<string, SeatRecord>();

  async listByEmail(email: string): Promise<SeatRecord[]> {
    const key = normalizeEmail(email);
    return [...this.rows.values()].filter((row) => row.email === key);
  }

  async getById(id: string): Promise<SeatRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async getByCheckoutSession(id: string): Promise<SeatRecord | null> {
    return [...this.rows.values()].find((row) => row.stripeCheckoutSessionId === id) ?? null;
  }

  async getBySubscription(id: string): Promise<SeatRecord | null> {
    return [...this.rows.values()].find((row) => row.stripeSubscriptionId === id) ?? null;
  }

  async upsert(seat: SeatRecord): Promise<SeatRecord> {
    const next = { ...seat, email: normalizeEmail(seat.email), updatedAt: new Date().toISOString() };
    this.rows.set(next.id, next);
    return next;
  }

  reset(): void {
    this.rows.clear();
  }
}

export class JsonSeatStore implements SeatStore {
  constructor(private readonly path: string) {}

  private async load(): Promise<SeatRecord[]> {
    try {
      const raw = await readFile(this.path, "utf8");
      if (!raw.trim()) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isSeatRecord);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return [];
      throw err;
    }
  }

  private async save(rows: SeatRecord[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(rows, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, this.path);
  }

  async listByEmail(email: string): Promise<SeatRecord[]> {
    const key = normalizeEmail(email);
    return (await this.load()).filter((row) => row.email === key);
  }

  async getById(id: string): Promise<SeatRecord | null> {
    return (await this.load()).find((row) => row.id === id) ?? null;
  }

  async getByCheckoutSession(id: string): Promise<SeatRecord | null> {
    return (await this.load()).find((row) => row.stripeCheckoutSessionId === id) ?? null;
  }

  async getBySubscription(id: string): Promise<SeatRecord | null> {
    return (await this.load()).find((row) => row.stripeSubscriptionId === id) ?? null;
  }

  async upsert(seat: SeatRecord): Promise<SeatRecord> {
    const next = { ...seat, email: normalizeEmail(seat.email), updatedAt: new Date().toISOString() };
    const rows = await this.load();
    const idx = rows.findIndex((row) => row.id === next.id);
    if (idx >= 0) rows[idx] = next;
    else rows.push(next);
    await this.save(rows);
    return next;
  }
}

function isSeatRecord(value: unknown): value is SeatRecord {
  if (typeof value !== "object" || value === null) return false;
  const row = value as SeatRecord;
  return (
    typeof row.id === "string" &&
    typeof row.email === "string" &&
    (row.plan === "spark" || row.plan === "desk" || row.plan === "shift") &&
    (row.status === "active" || row.status === "past_due" || row.status === "canceled")
  );
}

export class PostgresSeatStore implements SeatStore {
  constructor(private readonly databaseUrl: string) {}

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

  async listByEmail(email: string): Promise<SeatRecord[]> {
    return this.query<SeatRecord>(
      `SELECT id, email, plan, status,
              stripe_customer_id AS "stripeCustomerId",
              stripe_subscription_id AS "stripeSubscriptionId",
              stripe_checkout_session_id AS "stripeCheckoutSessionId",
              hours_included AS "hoursIncluded",
              hours_used AS "hoursUsed",
              period_start AS "periodStart",
              period_end AS "periodEnd",
              computer_id AS "computerId",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
         FROM billing_seats WHERE email = $1`,
      [normalizeEmail(email)],
    );
  }

  async getById(id: string): Promise<SeatRecord | null> {
    const rows = await this.query<SeatRecord>(
      `SELECT id, email, plan, status,
              stripe_customer_id AS "stripeCustomerId",
              stripe_subscription_id AS "stripeSubscriptionId",
              stripe_checkout_session_id AS "stripeCheckoutSessionId",
              hours_included AS "hoursIncluded",
              hours_used AS "hoursUsed",
              period_start AS "periodStart",
              period_end AS "periodEnd",
              computer_id AS "computerId",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
         FROM billing_seats WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async getByCheckoutSession(id: string): Promise<SeatRecord | null> {
    const rows = await this.query<SeatRecord>(
      `SELECT id, email, plan, status,
              stripe_customer_id AS "stripeCustomerId",
              stripe_subscription_id AS "stripeSubscriptionId",
              stripe_checkout_session_id AS "stripeCheckoutSessionId",
              hours_included AS "hoursIncluded",
              hours_used AS "hoursUsed",
              period_start AS "periodStart",
              period_end AS "periodEnd",
              computer_id AS "computerId",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
         FROM billing_seats WHERE stripe_checkout_session_id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async getBySubscription(id: string): Promise<SeatRecord | null> {
    const rows = await this.query<SeatRecord>(
      `SELECT id, email, plan, status,
              stripe_customer_id AS "stripeCustomerId",
              stripe_subscription_id AS "stripeSubscriptionId",
              stripe_checkout_session_id AS "stripeCheckoutSessionId",
              hours_included AS "hoursIncluded",
              hours_used AS "hoursUsed",
              period_start AS "periodStart",
              period_end AS "periodEnd",
              computer_id AS "computerId",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
         FROM billing_seats WHERE stripe_subscription_id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async upsert(seat: SeatRecord): Promise<SeatRecord> {
    const next = { ...seat, email: normalizeEmail(seat.email), updatedAt: new Date().toISOString() };
    await this.query(
      `INSERT INTO billing_seats (
          id, email, plan, status, stripe_customer_id, stripe_subscription_id,
          stripe_checkout_session_id, hours_included, hours_used, period_start,
          period_end, computer_id, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          plan = EXCLUDED.plan,
          status = EXCLUDED.status,
          stripe_customer_id = EXCLUDED.stripe_customer_id,
          stripe_subscription_id = EXCLUDED.stripe_subscription_id,
          stripe_checkout_session_id = EXCLUDED.stripe_checkout_session_id,
          hours_included = EXCLUDED.hours_included,
          hours_used = EXCLUDED.hours_used,
          period_start = EXCLUDED.period_start,
          period_end = EXCLUDED.period_end,
          computer_id = EXCLUDED.computer_id,
          updated_at = EXCLUDED.updated_at`,
      [
        next.id,
        next.email,
        next.plan,
        next.status,
        next.stripeCustomerId,
        next.stripeSubscriptionId,
        next.stripeCheckoutSessionId,
        next.hoursIncluded,
        next.hoursUsed,
        next.periodStart,
        next.periodEnd,
        next.computerId,
        next.createdAt,
        next.updatedAt,
      ],
    );
    return next;
  }
}

const memory = new MemorySeatStore();
let singleton: SeatStore | null = null;

function jailedSeatPath(userPath: string, cwd = process.cwd()): string {
  const resolved = resolve(cwd, userPath);
  const root = resolve(cwd, ".flok");
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error("FLOK_SEAT_STORE_PATH must stay under .flok");
  }
  return resolved;
}

export function seatStoreFromEnv(env: NodeJS.ProcessEnv = process.env): SeatStore {
  if (env.NODE_ENV === "test" || env.FLOK_WEB_SEAT_STORE === "memory") {
    return memory;
  }
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) return new PostgresSeatStore(databaseUrl);
  const filePath = env.FLOK_SEAT_STORE_PATH?.trim();
  if (filePath) return new JsonSeatStore(jailedSeatPath(filePath));
  return memory;
}

export function getSeatStore(): SeatStore {
  if (!singleton) singleton = seatStoreFromEnv();
  return singleton;
}

export function resetSeatStoreForTests(): void {
  memory.reset();
  singleton = memory;
}

export function periodLabel(seat: SeatRecord): string | null {
  if (seat.periodStart && seat.periodEnd) {
    const start = seat.periodStart.slice(0, 10);
    const end = seat.periodEnd.slice(0, 10);
    return `${start} – ${end}`;
  }
  if (seat.periodEnd) return `Renews ${seat.periodEnd.slice(0, 10)}`;
  return null;
}
