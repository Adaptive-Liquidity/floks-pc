/**
 * Draft launch plans — edit this file when the founder locks prices.
 * Stripe Price IDs come from env (test on Preview, live on Production).
 * Always-on is not a public plan.
 */

export const BRAND = {
  name: "Staxions",
  seller: "Adaptive Liquidity, Inc.",
  org: "Asentxia Systems",
} as const;

export const CHECKOUT_PLAN_IDS = ["personal", "pro", "team"] as const;
export const PUBLIC_PLAN_IDS = ["personal", "pro", "team", "enterprise"] as const;
export const LEGACY_PLAN_IDS = ["spark", "desk", "shift"] as const;

export type CheckoutPlanId = (typeof CHECKOUT_PLAN_IDS)[number];
export type PublicPlanId = (typeof PUBLIC_PLAN_IDS)[number];
export type LegacyPlanId = (typeof LEGACY_PLAN_IDS)[number];
export type PlanId = CheckoutPlanId | LegacyPlanId;

export type PlanCatalogEntry = {
  id: PublicPlanId;
  name: string;
  /** Monthly list price in cents. Team is per-agent. Enterprise is contact-only. */
  priceMonthlyCents: number | null;
  priceLabel: string;
  computers: number;
  includedHours: number;
  hoursPerAgent: number | null;
  minAgents: number;
  overagePerHourCents: number;
  overageEnabledDefault: false;
  checkout: boolean;
  stripePriceEnv: "STRIPE_PRICE_PERSONAL" | "STRIPE_PRICE_PRO" | "STRIPE_PRICE_TEAM" | null;
  highlight: boolean;
  blurb: string;
  short: string;
  line: string;
};

export const PLAN_CATALOG: Record<PublicPlanId, PlanCatalogEntry> = {
  personal: {
    id: "personal",
    name: "Personal",
    priceMonthlyCents: 2900,
    priceLabel: "$29/mo",
    computers: 1,
    includedHours: 10,
    hoursPerAgent: null,
    minAgents: 1,
    overagePerHourCents: 120,
    overageEnabledDefault: false,
    checkout: true,
    stripePriceEnv: "STRIPE_PRICE_PERSONAL",
    highlight: false,
    blurb: "1 computer · 10 included hours. Extra hours $1.20/h, off by default.",
    short: "Personal · $29/mo · 10h",
    line: "Personal — $29/mo — 10 hours — 1 computer",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthlyCents: 9900,
    priceLabel: "$99/mo",
    computers: 2,
    includedHours: 40,
    hoursPerAgent: null,
    minAgents: 1,
    overagePerHourCents: 120,
    overageEnabledDefault: false,
    checkout: true,
    stripePriceEnv: "STRIPE_PRICE_PRO",
    highlight: true,
    blurb: "2 computers · 40 shared hours. Extra hours $1.20/h, off by default.",
    short: "Pro · $99/mo · 40h",
    line: "Pro — $99/mo — 40 shared hours — 2 computers",
  },
  team: {
    id: "team",
    name: "Team",
    priceMonthlyCents: 7900,
    priceLabel: "$79 per agent/mo",
    computers: 1,
    includedHours: 30,
    hoursPerAgent: 30,
    minAgents: 3,
    overagePerHourCents: 120,
    overageEnabledDefault: false,
    checkout: true,
    stripePriceEnv: "STRIPE_PRICE_TEAM",
    highlight: false,
    blurb: "Minimum 3 agents. 30 pooled hours per agent. Extra hours $1.20/h, off by default.",
    short: "Team · $79/agent · 30h",
    line: "Team — $79 per agent/mo — 30 hours per agent — minimum 3 agents",
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    priceMonthlyCents: null,
    priceLabel: "Talk to us",
    computers: 0,
    includedHours: 0,
    hoursPerAgent: null,
    minAgents: 1,
    overagePerHourCents: 110,
    overageEnabledDefault: false,
    checkout: false,
    stripePriceEnv: null,
    highlight: false,
    blurb: "Pilot or design-partner only. No self-serve checkout.",
    short: "Enterprise · Talk to us",
    line: "Enterprise — contact / paid pilot only",
  },
};

export const CHECKOUT_PLANS: readonly PlanCatalogEntry[] = CHECKOUT_PLAN_IDS.map(
  (id) => PLAN_CATALOG[id],
);

export const DEFAULT_IDLE_MINUTES = 30;
export const DEFAULT_OVERAGE_PER_HOUR_CENTS = 120;
/** Runloop documents a practical keep-alive cap around one hour. Cron refreshes it. */
export const RUNLOOP_KEEP_ALIVE_MAX_SECONDS = 60 * 60;
export const RUNLOOP_KEEP_ALIVE_MIN_SECONDS = 15 * 60;

const LEGACY_TO_CURRENT: Record<LegacyPlanId, CheckoutPlanId> = {
  spark: "personal",
  desk: "pro",
  shift: "team",
};

export function isCheckoutPlanId(value: string): value is CheckoutPlanId {
  return (CHECKOUT_PLAN_IDS as readonly string[]).includes(value);
}

export function isPlanId(value: string): value is PlanId {
  return (
    isCheckoutPlanId(value) || (LEGACY_PLAN_IDS as readonly string[]).includes(value)
  );
}

export function normalizePlanId(raw: unknown): CheckoutPlanId | null {
  if (typeof raw !== "string") return null;
  const lower = raw.trim().toLowerCase();
  if (isCheckoutPlanId(lower)) return lower;
  if (lower === "spark" || lower === "desk" || lower === "shift") {
    return LEGACY_TO_CURRENT[lower];
  }
  return null;
}

export function stripePriceEnvName(plan: CheckoutPlanId): string {
  return PLAN_CATALOG[plan].stripePriceEnv ?? `STRIPE_PRICE_${plan.toUpperCase()}`;
}

export function stripePriceIdForPlan(
  plan: CheckoutPlanId,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const key = stripePriceEnvName(plan);
  const value = env[key]?.trim() ?? "";
  return value || null;
}

export function planFromStripePriceId(
  priceId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): CheckoutPlanId | null {
  const id = priceId?.trim() ?? "";
  if (!id) return null;
  for (const plan of CHECKOUT_PLAN_IDS) {
    if (stripePriceIdForPlan(plan, env) === id) return plan;
  }
  return null;
}

export function checkoutBlocked(plan: string, quantity: number): "team_minimum" | null {
  if (plan === "team" && quantity < 3) return "team_minimum";
  return null;
}

export function recordedAgentQuantity(raw: number): number {
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.floor(raw);
}

export function clampAgentQuantity(plan: CheckoutPlanId, raw: number): number {
  const entry = PLAN_CATALOG[plan];
  if (!Number.isFinite(raw) || raw < 1) return entry.minAgents;
  const qty = Math.floor(raw);
  return Math.max(qty, entry.minAgents);
}

export function computersForPurchase(plan: CheckoutPlanId, quantity: number): number {
  const entry = PLAN_CATALOG[plan];
  const qty = clampAgentQuantity(plan, quantity);
  if (plan === "team") return qty;
  return entry.computers;
}

export function hoursForPurchase(plan: CheckoutPlanId, quantity: number): number {
  const entry = PLAN_CATALOG[plan];
  const qty = clampAgentQuantity(plan, quantity);
  if (plan === "team") return (entry.hoursPerAgent ?? entry.includedHours) * qty;
  return entry.includedHours;
}

export function idleMinutesFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.STAXIONS_IDLE_MINUTES?.trim() ?? env.FLOK_IDLE_MINUTES?.trim());
  if (Number.isFinite(raw) && raw >= 5 && raw <= 24 * 60) return Math.floor(raw);
  return DEFAULT_IDLE_MINUTES;
}

export function keepAliveSecondsForPlan(input: {
  remainingHours: number;
  idleMinutes?: number;
}): number {
  const idleMinutes = input.idleMinutes ?? DEFAULT_IDLE_MINUTES;
  const idleSeconds = Math.max(idleMinutes * 60, RUNLOOP_KEEP_ALIVE_MIN_SECONDS);
  const remainingSeconds = Math.max(0, Math.floor(input.remainingHours * 3600));
  const target = remainingSeconds > 0 ? Math.min(remainingSeconds, idleSeconds) : idleSeconds;
  return Math.min(Math.max(target, RUNLOOP_KEEP_ALIVE_MIN_SECONDS), RUNLOOP_KEEP_ALIVE_MAX_SECONDS);
}

export function enterpriseContactHref(supportEmail: string): string {
  const subject = encodeURIComponent("Staxions Enterprise / pilot");
  return `mailto:${supportEmail}?subject=${subject}`;
}
