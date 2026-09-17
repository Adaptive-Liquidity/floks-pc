import { PLAN_HOURS } from "../config";
import type { PlanId } from "../types";

export { PLAN_HOURS };

export function planFromAmount(amountTotal: number | null | undefined): PlanId | null {
  if (amountTotal === 1900) return "spark";
  if (amountTotal === 3900) return "desk";
  if (amountTotal === 6900) return "shift";
  return null;
}

export function planFromUnknown(raw: unknown): PlanId | null {
  if (raw === "spark" || raw === "desk" || raw === "shift") return raw;
  if (typeof raw === "string") {
    const lower = raw.trim().toLowerCase();
    if (lower === "spark" || lower === "desk" || lower === "shift") return lower;
  }
  return null;
}

export function hoursForPlan(plan: PlanId): number {
  return PLAN_HOURS[plan];
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailsMatch(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}
