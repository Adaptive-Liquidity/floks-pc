/** Whether `billing_seats.grace_until` / `billing_event_at` exist (migration 0010). */

export const GRACE_NEGATIVE_PROBE_TTL_MS = 60_000;

const globalGrace = globalThis as typeof globalThis & {
  __staxGraceColumns?: boolean;
  __staxGraceProbedAt?: number;
  __staxGraceWarned?: boolean;
};

export function graceColumnsReady(): boolean {
  return globalGrace.__staxGraceColumns !== false;
}

export function graceProbeIsStale(nowMs: number = Date.now()): boolean {
  if (globalGrace.__staxGraceColumns !== false) return false;
  const at = globalGrace.__staxGraceProbedAt;
  if (at === undefined) return true;
  return nowMs - at >= GRACE_NEGATIVE_PROBE_TTL_MS;
}

export function setGraceColumnsReady(ready: boolean, nowMs: number = Date.now()): void {
  globalGrace.__staxGraceColumns = ready;
  globalGrace.__staxGraceProbedAt = nowMs;
  if (ready) globalGrace.__staxGraceWarned = false;
}

export function resetGraceColumnsForTests(): void {
  delete globalGrace.__staxGraceColumns;
  delete globalGrace.__staxGraceProbedAt;
  delete globalGrace.__staxGraceWarned;
}

export function warnMissingGraceColumnsOnce(nowMs: number = Date.now()): void {
  setGraceColumnsReady(false, nowMs);
  if (globalGrace.__staxGraceWarned) return;
  globalGrace.__staxGraceWarned = true;
  console.warn(
    "[billing] billing_seats is missing grace_until/billing_event_at. Apply migrations/0010_billing_grace.sql for 72-hour grace. Until then grace is zero: past_due and canceled are held immediately. The app stays up.",
  );
}

export function isUndefinedColumnError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "42703";
}
