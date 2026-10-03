import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import {
  computersForPurchase,
  hoursForPurchase,
  normalizePlanId,
  type CheckoutPlanId,
  type PlanId,
} from "./catalog";
import { normalizeEmail } from "./plans";
import {
  graceProbeIsStale,
  isUndefinedColumnError,
  resetGraceColumnsForTests,
  setGraceColumnsReady,
  warnMissingGraceColumnsOnce,
} from "./grace-schema";

function hoursFromSeconds(seconds: number): number {
  return seconds / 3600;
}

export type SeatStatus = "active" | "past_due" | "canceled";

export type SeatRecord = {
  id: string;
  email: string;
  plan: CheckoutPlanId;
  status: SeatStatus;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripeCheckoutSessionId: string | null;
  stripePriceId: string | null;
  hoursIncluded: number;
  hoursUsed: number;
  secondsUsed: number;
  overageEnabled: boolean;
  maxComputers: number;
  agentQuantity: number;
  periodStart: string | null;
  periodEnd: string | null;
  computerId: string | null;
  computerIds: string[];
  lastMeteredAt: string | null;
  graceUntil: string | null;
  billingEventAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export interface SeatStore {
  listByEmail(email: string): Promise<SeatRecord[]>;
  listAll(): Promise<SeatRecord[]>;
  getById(id: string): Promise<SeatRecord | null>;
  getByCheckoutSession(id: string): Promise<SeatRecord | null>;
  getBySubscription(id: string): Promise<SeatRecord | null>;
  upsert(seat: SeatRecord): Promise<SeatRecord>;
}

export class DurableStoreRequired extends Error {
  constructor(
    message = "DATABASE_URL is required on Vercel and in production. Local development may use memory or FLOK_SEAT_STORE_PATH under .flok.",
  ) {
    super(message);
    this.name = "DurableStoreRequired";
  }
}

export function newSeatId(): string {
  return randomBytes(16).toString("hex");
}

export function requiresDurableStore(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "test") return false;
  if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production") return true;
  return env.VERCEL === "1";
}

function asCheckoutPlan(plan: PlanId | CheckoutPlanId): CheckoutPlanId {
  return normalizePlanId(plan) ?? "personal";
}

export function createSeat(input: {
  email: string;
  plan: PlanId;
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripePriceId?: string | null;
  status?: SeatStatus;
  hoursUsed?: number;
  secondsUsed?: number;
  overageEnabled?: boolean;
  maxComputers?: number;
  agentQuantity?: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  computerId?: string | null;
  computerIds?: string[];
  lastMeteredAt?: string | null;
  graceUntil?: string | null;
  billingEventAt?: string | null;
}): SeatRecord {
  const now = new Date().toISOString();
  const plan = asCheckoutPlan(input.plan);
  const agentQuantity = Math.max(1, input.agentQuantity ?? 1);
  const secondsUsed =
    input.secondsUsed ??
    (typeof input.hoursUsed === "number" ? Math.round(input.hoursUsed * 3600) : 0);
  const computerIds = input.computerIds?.filter(Boolean) ?? [];
  if (input.computerId && !computerIds.includes(input.computerId)) {
    computerIds.unshift(input.computerId);
  }
  return {
    id: newSeatId(),
    email: normalizeEmail(input.email),
    plan,
    status: input.status ?? "active",
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId ?? null,
    stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? null,
    stripePriceId: input.stripePriceId ?? null,
    hoursIncluded: hoursForPurchase(plan, agentQuantity),
    hoursUsed: hoursFromSeconds(secondsUsed),
    secondsUsed,
    overageEnabled: input.overageEnabled ?? false,
    maxComputers: input.maxComputers ?? computersForPurchase(plan, agentQuantity),
    agentQuantity,
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    computerId: computerIds[0] ?? input.computerId ?? null,
    computerIds,
    lastMeteredAt: input.lastMeteredAt ?? now,
    graceUntil: input.graceUntil ?? null,
    billingEventAt: input.billingEventAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeSeat(seat: SeatRecord): SeatRecord {
  const computerIds = [...seat.computerIds];
  if (seat.computerId && !computerIds.includes(seat.computerId)) computerIds.unshift(seat.computerId);
  const secondsUsed = Number.isFinite(seat.secondsUsed)
    ? seat.secondsUsed
    : Math.round((seat.hoursUsed ?? 0) * 3600);
  return {
    ...seat,
    email: normalizeEmail(seat.email),
    plan: asCheckoutPlan(seat.plan),
    secondsUsed,
    hoursUsed: hoursFromSeconds(secondsUsed),
    computerIds,
    computerId: computerIds[0] ?? seat.computerId ?? null,
    overageEnabled: Boolean(seat.overageEnabled),
    maxComputers: seat.maxComputers || 1,
    agentQuantity: seat.agentQuantity || 1,
    graceUntil: seat.graceUntil ?? null,
    billingEventAt: seat.billingEventAt ?? null,
    updatedAt: new Date().toISOString(),
  };
}

export class MemorySeatStore implements SeatStore {
  private rows = new Map<string, SeatRecord>();

  async listByEmail(email: string): Promise<SeatRecord[]> {
    const key = normalizeEmail(email);
    return [...this.rows.values()].filter((row) => row.email === key);
  }

  async listAll(): Promise<SeatRecord[]> {
    return [...this.rows.values()];
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
    const next = normalizeSeat(seat);
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
      return parsed.filter(isSeatRecord).map((row) => hydrateSeat(row));
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

  async listAll(): Promise<SeatRecord[]> {
    return this.load();
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
    const next = normalizeSeat(seat);
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
    Boolean(normalizePlanId(row.plan)) &&
    (row.status === "active" || row.status === "past_due" || row.status === "canceled")
  );
}

function hydrateSeat(row: SeatRecord): SeatRecord {
  const computerIds = Array.isArray(row.computerIds) ? row.computerIds.filter(Boolean) : [];
  if (row.computerId && !computerIds.includes(row.computerId)) computerIds.unshift(row.computerId);
  const secondsUsed =
    typeof row.secondsUsed === "number" ? row.secondsUsed : Math.round((row.hoursUsed ?? 0) * 3600);
  const plan = asCheckoutPlan(row.plan);
  const agentQuantity = row.agentQuantity || 1;
  return {
    ...row,
    plan,
    secondsUsed,
    hoursUsed: hoursFromSeconds(secondsUsed),
    hoursIncluded: row.hoursIncluded || hoursForPurchase(plan, agentQuantity),
    overageEnabled: Boolean(row.overageEnabled),
    maxComputers: row.maxComputers || computersForPurchase(plan, agentQuantity),
    agentQuantity,
    stripePriceId: row.stripePriceId ?? null,
    computerIds,
    computerId: computerIds[0] ?? row.computerId ?? null,
    lastMeteredAt: row.lastMeteredAt ?? row.updatedAt ?? null,
    graceUntil: asIso(row.graceUntil),
    billingEventAt: asIso(row.billingEventAt),
  };
}

function asIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const raw = String(value);
  if (!raw || raw === "null" || raw === "undefined") return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : raw;
}

export type SeatSqlQuery = <T>(text: string, values: unknown[]) => Promise<T[]>;

const SEAT_SELECT_CORE = `SELECT id, email, plan, status,
              stripe_customer_id AS "stripeCustomerId",
              stripe_subscription_id AS "stripeSubscriptionId",
              stripe_checkout_session_id AS "stripeCheckoutSessionId",
              stripe_price_id AS "stripePriceId",
              hours_included AS "hoursIncluded",
              hours_used AS "hoursUsed",
              seconds_used AS "secondsUsed",
              overage_enabled AS "overageEnabled",
              max_computers AS "maxComputers",
              agent_quantity AS "agentQuantity",
              period_start AS "periodStart",
              period_end AS "periodEnd",
              computer_id AS "computerId",
              computer_ids AS "computerIds",
              last_metered_at AS "lastMeteredAt"`;

const SEAT_SELECT_GRACE = `,
              grace_until AS "graceUntil",
              billing_event_at AS "billingEventAt"`;

export function seatSelectSql(hasGraceColumns: boolean): string {
  return `${SEAT_SELECT_CORE}${hasGraceColumns ? SEAT_SELECT_GRACE : ""},
              created_at AS "createdAt",
              updated_at AS "updatedAt"
         FROM billing_seats`;
}

export function seatUpsertSql(hasGraceColumns: boolean): string {
  if (hasGraceColumns) {
    return `INSERT INTO billing_seats (
          id, email, plan, status, stripe_customer_id, stripe_subscription_id,
          stripe_checkout_session_id, stripe_price_id, hours_included, hours_used,
          seconds_used, overage_enabled, max_computers, agent_quantity, period_start,
          period_end, computer_id, computer_ids, last_metered_at, grace_until,
          billing_event_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          plan = EXCLUDED.plan,
          status = EXCLUDED.status,
          stripe_customer_id = EXCLUDED.stripe_customer_id,
          stripe_subscription_id = EXCLUDED.stripe_subscription_id,
          stripe_checkout_session_id = EXCLUDED.stripe_checkout_session_id,
          stripe_price_id = EXCLUDED.stripe_price_id,
          hours_included = EXCLUDED.hours_included,
          hours_used = EXCLUDED.hours_used,
          seconds_used = EXCLUDED.seconds_used,
          overage_enabled = EXCLUDED.overage_enabled,
          max_computers = EXCLUDED.max_computers,
          agent_quantity = EXCLUDED.agent_quantity,
          period_start = EXCLUDED.period_start,
          period_end = EXCLUDED.period_end,
          computer_id = EXCLUDED.computer_id,
          computer_ids = EXCLUDED.computer_ids,
          last_metered_at = EXCLUDED.last_metered_at,
          grace_until = EXCLUDED.grace_until,
          billing_event_at = EXCLUDED.billing_event_at,
          updated_at = EXCLUDED.updated_at`;
  }
  return `INSERT INTO billing_seats (
          id, email, plan, status, stripe_customer_id, stripe_subscription_id,
          stripe_checkout_session_id, stripe_price_id, hours_included, hours_used,
          seconds_used, overage_enabled, max_computers, agent_quantity, period_start,
          period_end, computer_id, computer_ids, last_metered_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          plan = EXCLUDED.plan,
          status = EXCLUDED.status,
          stripe_customer_id = EXCLUDED.stripe_customer_id,
          stripe_subscription_id = EXCLUDED.stripe_subscription_id,
          stripe_checkout_session_id = EXCLUDED.stripe_checkout_session_id,
          stripe_price_id = EXCLUDED.stripe_price_id,
          hours_included = EXCLUDED.hours_included,
          hours_used = EXCLUDED.hours_used,
          seconds_used = EXCLUDED.seconds_used,
          overage_enabled = EXCLUDED.overage_enabled,
          max_computers = EXCLUDED.max_computers,
          agent_quantity = EXCLUDED.agent_quantity,
          period_start = EXCLUDED.period_start,
          period_end = EXCLUDED.period_end,
          computer_id = EXCLUDED.computer_id,
          computer_ids = EXCLUDED.computer_ids,
          last_metered_at = EXCLUDED.last_metered_at,
          updated_at = EXCLUDED.updated_at`;
}

export function seatUpsertValues(seat: SeatRecord, hasGraceColumns: boolean): unknown[] {
  const core = [
    seat.id,
    seat.email,
    seat.plan,
    seat.status,
    seat.stripeCustomerId,
    seat.stripeSubscriptionId,
    seat.stripeCheckoutSessionId,
    seat.stripePriceId,
    seat.hoursIncluded,
    seat.hoursUsed,
    seat.secondsUsed,
    seat.overageEnabled,
    seat.maxComputers,
    seat.agentQuantity,
    seat.periodStart,
    seat.periodEnd,
    seat.computerId,
    seat.computerIds,
    seat.lastMeteredAt,
  ];
  if (hasGraceColumns) {
    return [...core, seat.graceUntil, seat.billingEventAt, seat.createdAt, seat.updatedAt];
  }
  return [...core, seat.createdAt, seat.updatedAt];
}

const GRACE_PROBE_SQL = `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'billing_seats'
           AND column_name = 'grace_until'
       ) AS exists`;

export class PostgresSeatStore implements SeatStore {
  private graceColumns: boolean | null = null;

  constructor(
    private readonly databaseUrl: string,
    private readonly injectedQuery?: SeatSqlQuery,
  ) {}

  private async rawQuery<T>(text: string, values: unknown[]): Promise<T[]> {
    if (this.injectedQuery) return this.injectedQuery<T>(text, values);
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

  private async resolveGraceColumns(): Promise<boolean> {
    if (this.graceColumns === true) return true;
    if (this.graceColumns === false && !graceProbeIsStale()) return false;
    try {
      const rows = await this.rawQuery<{ exists?: boolean | string }>(GRACE_PROBE_SQL, []);
      const value = rows[0]?.exists;
      this.graceColumns = value === true || value === "t";
    } catch {
      this.graceColumns = true;
    }
    if (this.graceColumns) setGraceColumnsReady(true);
    else warnMissingGraceColumnsOnce();
    return this.graceColumns;
  }

  private markGraceMissing(): void {
    this.graceColumns = false;
    warnMissingGraceColumnsOnce();
  }

  private async withGraceFallback<T>(run: (hasGrace: boolean) => Promise<T>): Promise<T> {
    const hasGrace = await this.resolveGraceColumns();
    try {
      return await run(hasGrace);
    } catch (err) {
      if (hasGrace && isUndefinedColumnError(err)) {
        this.markGraceMissing();
        return run(false);
      }
      throw err;
    }
  }

  private map(row: SeatRecord): SeatRecord {
    const computerIds = Array.isArray(row.computerIds)
      ? row.computerIds
      : typeof row.computerIds === "string"
        ? (JSON.parse(row.computerIds) as string[])
        : [];
    return hydrateSeat({ ...row, computerIds });
  }

  async listByEmail(email: string): Promise<SeatRecord[]> {
    return this.runSelect(`WHERE email = $1`, [normalizeEmail(email)]);
  }

  async listAll(): Promise<SeatRecord[]> {
    return this.runSelect("", []);
  }

  async getById(id: string): Promise<SeatRecord | null> {
    const rows = await this.runSelect(`WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async getByCheckoutSession(id: string): Promise<SeatRecord | null> {
    const rows = await this.runSelect(`WHERE stripe_checkout_session_id = $1`, [id]);
    return rows[0] ?? null;
  }

  async getBySubscription(id: string): Promise<SeatRecord | null> {
    const rows = await this.runSelect(`WHERE stripe_subscription_id = $1`, [id]);
    return rows[0] ?? null;
  }

  async upsert(seat: SeatRecord): Promise<SeatRecord> {
    const next = normalizeSeat(seat);
    await this.withGraceFallback(async (hasGrace) => {
      await this.rawQuery(seatUpsertSql(hasGrace), seatUpsertValues(next, hasGrace));
    });
    if (!(await this.resolveGraceColumns())) {
      return { ...next, graceUntil: null, billingEventAt: null };
    }
    return next;
  }

  private async runSelect(where: string, values: unknown[]): Promise<SeatRecord[]> {
    return this.withGraceFallback(async (hasGrace) => {
      const sql = `${seatSelectSql(hasGrace)}${where ? ` ${where}` : ""}`;
      const rows = await this.rawQuery<SeatRecord>(sql, values);
      return rows.map((row) => this.map(row));
    });
  }
}

const globalSeats = globalThis as typeof globalThis & {
  __staxSeatMemory?: MemorySeatStore;
  __staxSeatStore?: SeatStore | null;
};

function sharedMemory(): MemorySeatStore {
  if (!globalSeats.__staxSeatMemory) globalSeats.__staxSeatMemory = new MemorySeatStore();
  return globalSeats.__staxSeatMemory;
}

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
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) return new PostgresSeatStore(databaseUrl);
  if (requiresDurableStore(env)) {
    throw new DurableStoreRequired();
  }
  if (env.NODE_ENV === "test" || env.FLOK_WEB_SEAT_STORE === "memory") {
    return sharedMemory();
  }
  const filePath = env.FLOK_SEAT_STORE_PATH?.trim();
  if (filePath) return new JsonSeatStore(jailedSeatPath(filePath));
  return sharedMemory();
}

export function getSeatStore(): SeatStore {
  if (globalSeats.__staxSeatStore) return globalSeats.__staxSeatStore;
  globalSeats.__staxSeatStore = seatStoreFromEnv();
  return globalSeats.__staxSeatStore;
}

export function setSeatStoreForTests(store: SeatStore | null): void {
  globalSeats.__staxSeatStore = store;
}

export function resetSeatStoreForTests(): void {
  const memory = sharedMemory();
  memory.reset();
  globalSeats.__staxSeatStore = memory;
  resetGraceColumnsForTests();
}

export function periodLabel(seat: SeatRecord): string | null {
  if (seat.periodStart && seat.periodEnd) {
    const start = String(seat.periodStart).slice(0, 10);
    const end = String(seat.periodEnd).slice(0, 10);
    return `${start} – ${end}`;
  }
  if (seat.periodEnd) return `Renews ${String(seat.periodEnd).slice(0, 10)}`;
  return null;
}
