import type Stripe from "stripe";

export function resetPortalConfigCacheForTests(): void {
  // Portal config is env-only. Kept so tests can reset without a process cache.
}

export function portalFeatureFlags(): {
  invoice_history: { enabled: true };
  payment_method_update: { enabled: true };
  customer_update: { enabled: true; allowed_updates: Array<"email" | "address"> };
  subscription_cancel: { enabled: true; mode: "at_period_end" };
  subscription_update: {
    enabled: true;
    default_allowed_updates: Array<"price" | "quantity">;
  };
} {
  return {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    customer_update: { enabled: true, allowed_updates: ["email", "address"] },
    subscription_cancel: { enabled: true, mode: "at_period_end" },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price", "quantity"],
    },
  };
}

export function portalProductsFromPrices(
  rows: Array<{ priceId: string; productId: string }>,
): Array<{ product: string; prices: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const prices = grouped.get(row.productId) ?? [];
    if (!prices.includes(row.priceId)) prices.push(row.priceId);
    grouped.set(row.productId, prices);
  }
  return [...grouped.entries()].map(([product, prices]) => ({ product, prices }));
}

/** Dashboard or env config only. Do not create a portal config in-process — that is not shared across instances. */
export async function resolvePortalConfigurationId(
  _client: Stripe,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const configured = env.STRIPE_PORTAL_CONFIGURATION_ID?.trim();
  return configured || undefined;
}
