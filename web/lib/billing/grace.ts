import { graceColumnsReady } from "./grace-schema";
import type { SeatRecord } from "./seats";

/** Default hold after a failed payment or cancel. Cron is not required. */
export const DEFAULT_BILLING_GRACE_HOURS = 72;

export function billingGraceHours(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.STAXIONS_BILLING_GRACE_HOURS?.trim());
  if (Number.isFinite(raw) && raw >= 1 && raw <= 24 * 30) return Math.floor(raw);
  return DEFAULT_BILLING_GRACE_HOURS;
}

export function eventCreatedMs(created: unknown): number | null {
  if (typeof created !== "number" || !Number.isFinite(created)) return null;
  return created * 1000;
}

export function eventCreatedIso(created: unknown): string | null {
  const ms = eventCreatedMs(created);
  return ms === null ? null : new Date(ms).toISOString();
}

export function isStaleBillingEvent(
  seat: Pick<SeatRecord, "billingEventAt">,
  created: unknown,
): boolean {
  if (!seat.billingEventAt) return false;
  const previous = Date.parse(seat.billingEventAt);
  const next = eventCreatedMs(created);
  if (!Number.isFinite(previous) || next === null) return false;
  return next < previous;
}

export function graceExpired(
  seat: Pick<SeatRecord, "status" | "graceUntil">,
  nowMs: number = Date.now(),
): boolean {
  if (!graceColumnsReady()) return false;
  if (seat.status !== "past_due" && seat.status !== "canceled") return false;
  if (!seat.graceUntil) return true;
  const until = Date.parse(seat.graceUntil);
  if (!Number.isFinite(until)) return true;
  return nowMs >= until;
}

export function graceAllowsAccess(
  seat: Pick<SeatRecord, "status" | "graceUntil">,
  nowMs: number = Date.now(),
): boolean {
  if (seat.status === "active") return true;
  if (seat.status !== "past_due" && seat.status !== "canceled") return false;
  if (!graceColumnsReady()) return true;
  return !graceExpired(seat, nowMs);
}

export function startGrace(
  seat: SeatRecord,
  nowMs: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): SeatRecord {
  if (!graceColumnsReady()) return seat;
  if (seat.graceUntil) return seat;
  const until = new Date(nowMs + billingGraceHours(env) * 3600 * 1000).toISOString();
  return { ...seat, graceUntil: until };
}

export function clearGrace(seat: SeatRecord): SeatRecord {
  if (!seat.graceUntil) return seat;
  return { ...seat, graceUntil: null };
}

export function withBillingEventAt(seat: SeatRecord, created: unknown): SeatRecord {
  const iso = eventCreatedIso(created);
  if (!iso) return seat;
  if (seat.billingEventAt && Date.parse(seat.billingEventAt) > Date.parse(iso)) return seat;
  return { ...seat, billingEventAt: iso };
}
