import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  portalFeatureFlags,
  portalProductsFromPrices,
  resetPortalConfigCacheForTests,
  resolvePortalConfigurationId,
} from "../../web/lib/billing/portal.ts";
import { createCustomerPortalUrl, resetStripeForTests, setStripeForTests } from "../../web/lib/billing/stripe.ts";

describe("customer portal", () => {
  afterEach(() => {
    resetPortalConfigCacheForTests();
    resetStripeForTests();
    delete process.env.STRIPE_PORTAL_CONFIGURATION_ID;
  });

  it("enables plan, quantity, and cancel-at-period-end", () => {
    const flags = portalFeatureFlags();
    assert.equal(flags.subscription_update.enabled, true);
    assert.deepEqual(flags.subscription_update.default_allowed_updates, ["price", "quantity"]);
    assert.equal(flags.subscription_cancel.enabled, true);
    assert.equal(flags.subscription_cancel.mode, "at_period_end");
    assert.deepEqual(
      portalProductsFromPrices([
        { priceId: "price_a", productId: "prod_1" },
        { priceId: "price_b", productId: "prod_1" },
        { priceId: "price_c", productId: "prod_2" },
      ]),
      [
        { product: "prod_1", prices: ["price_a", "price_b"] },
        { product: "prod_2", prices: ["price_c"] },
      ],
    );
  });

  it("uses the env configuration id and does not invent one in memory", async () => {
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = "bpc_from_env";
    const id = await resolvePortalConfigurationId({} as never);
    assert.equal(id, "bpc_from_env");
    const created: Array<Record<string, unknown>> = [];
    setStripeForTests({
      billingPortal: {
        sessions: {
          create: async (params: Record<string, unknown>) => {
            created.push(params);
            return { url: "https://billing.example.test/session" };
          },
        },
      },
    } as never);
    const url = await createCustomerPortalUrl("cus_1", "https://example.test/setup");
    assert.equal(url, "https://billing.example.test/session");
    assert.equal(created[0]?.configuration, "bpc_from_env");
    assert.equal(created[0]?.customer, "cus_1");
  });

  it("returns null without a Stripe client", async () => {
    setStripeForTests(null);
    assert.equal(await createCustomerPortalUrl("cus_1", "https://example.test/setup"), null);
  });
});
