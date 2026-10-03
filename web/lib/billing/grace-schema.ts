/** Whether `billing_seats.grace_until` / `billing_event_at` exist (migration 0010). */

const globalGrace = globalThis as typeof globalThis & {
  __staxGraceColumns?: boolean;
  __staxGraceWarned?: boolean;
};

export function graceColumnsReady(): boolean {
  return globalGrace.__staxGraceColumns !== false;
}

export function setGraceColumnsReady(ready: boolean): void {
  globalGrace.__staxGraceColumns = ready;
  if (ready) globalGrace.__staxGraceWarned = false;
}

export function resetGraceColumnsForTests(): void {
  delete globalGrace.__staxGraceColumns;
  delete globalGrace.__staxGraceWarned;
}

export function warnMissingGraceColumnsOnce(): void {
  globalGrace.__staxGraceColumns = false;
  if (globalGrace.__staxGraceWarned) return;
  globalGrace.__staxGraceWarned = true;
  console.warn(
    "[billing] billing_seats is missing grace_until/billing_event_at. Apply migrations/0010_billing_grace.sql for 72-hour grace. The app stays up; grace is off.",
  );
}

export function isUndefinedColumnError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "42703";
}
