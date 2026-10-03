import {
  hoursForPurchase,
  normalizePlanId,
  planFromStripePriceId,
  type CheckoutPlanId,
  type PlanId,
} from "./catalog";

export type { CheckoutPlanId, PlanId };

export function planFromUnknown(raw: unknown): CheckoutPlanId | null {
  return normalizePlanId(raw);
}

/** Entitlement is by Stripe Price ID (or checkout metadata), never by amount. */
export function planFromAmount(_amountTotal: number | null | undefined): CheckoutPlanId | null {
  return null;
}

export function planFromPriceId(
  priceId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): CheckoutPlanId | null {
  return planFromStripePriceId(priceId, env);
}

export function hoursForPlan(plan: PlanId, quantity = 1): number {
  const current = normalizePlanId(plan);
  if (!current) return 0;
  return hoursForPurchase(current, quantity);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailsMatch(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}

export function firstPriceIdFromUnknown(raw: unknown): string | null {
  if (typeof raw === "string" && raw.startsWith("price_")) return raw;
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as { id?: unknown; price?: unknown };
  if (typeof obj.id === "string" && obj.id.startsWith("price_")) return obj.id;
  return firstPriceIdFromUnknown(obj.price);
}
