import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computersForPurchase,
  checkoutBlocked,
  hoursForPurchase,
  planFromStripePriceId,
  stripePriceIdForPlan,
  keepAliveSecondsForPlan,
  normalizePlanId,
} from "../../web/lib/billing/catalog.ts";
import { planFromAmount, planFromPriceId } from "../../web/lib/billing/plans.ts";
import {
  planFromCheckout,
  planFromSubscription,
  priceIdFromCheckout,
} from "../../web/lib/billing/stripe.ts";
import type Stripe from "stripe";

describe("plan catalog and price-id mapping", () => {
  it("maps Personal / Pro / Team hours and computer counts from the draft catalog", () => {
    assert.equal(hoursForPurchase("personal", 1), 10);
    assert.equal(computersForPurchase("personal", 1), 1);
    assert.equal(hoursForPurchase("pro", 1), 40);
    assert.equal(computersForPurchase("pro", 1), 2);
    assert.equal(hoursForPurchase("team", 2), 90);
    assert.equal(computersForPurchase("team", 2), 3);
    assert.equal(hoursForPurchase("team", 5), 150);
    assert.equal(computersForPurchase("team", 5), 5);
    assert.equal(checkoutBlocked("team", 2), "team_minimum");
    assert.equal(checkoutBlocked("team", 3), null);
    assert.equal(normalizePlanId("spark"), "personal");
    assert.equal(normalizePlanId("DESK"), "pro");
  });

  it("never grants a plan from a payment amount", () => {
    assert.equal(planFromAmount(1900), null);
    assert.equal(planFromAmount(2900), null);
    assert.equal(planFromAmount(9900), null);
    assert.equal(planFromAmount(23700), null);
  });

  it("maps Stripe price ids from env, not from leftover Spark/Desk/Shift amounts", () => {
    const env = {
      STRIPE_PRICE_PERSONAL: "price_test_personal",
      STRIPE_PRICE_PRO: "price_test_pro",
      STRIPE_PRICE_TEAM: "price_test_team",
    };
    assert.equal(stripePriceIdForPlan("personal", env), "price_test_personal");
    assert.equal(planFromStripePriceId("price_test_pro", env), "pro");
    assert.equal(planFromStripePriceId("price_test_team", env), "team");
    assert.equal(planFromStripePriceId("price_unknown", env), null);
    assert.equal(planFromPriceId("price_test_personal", env), "personal");
  });

  it("reads the plan from checkout metadata or the line-item price id", () => {
    const env = { STRIPE_PRICE_PRO: "price_pro_1" };
    const previous = process.env.STRIPE_PRICE_PRO;
    process.env.STRIPE_PRICE_PRO = "price_pro_1";
    try {
      const fromMeta = planFromCheckout({
        metadata: { plan: "personal" },
        amount_total: 9900,
        line_items: { data: [] },
      } as unknown as Stripe.Checkout.Session);
      assert.equal(fromMeta, "personal");
      const fromPrice = planFromCheckout({
        metadata: {},
        amount_total: 1900,
        line_items: { data: [{ price: { id: "price_pro_1" }, quantity: 1 }] },
      } as unknown as Stripe.Checkout.Session);
      assert.equal(fromPrice, "pro");
      assert.equal(
        priceIdFromCheckout({
          metadata: { price_id: "price_pro_1" },
        } as unknown as Stripe.Checkout.Session),
        "price_pro_1",
      );
      const subPlan = planFromSubscription({
        metadata: {},
        items: { data: [{ price: { id: "price_pro_1" }, quantity: 1 }] },
      } as unknown as Stripe.Subscription);
      assert.equal(subPlan, "pro");
    } finally {
      if (previous === undefined) delete process.env.STRIPE_PRICE_PRO;
      else process.env.STRIPE_PRICE_PRO = previous;
    }
    assert.ok(env.STRIPE_PRICE_PRO);
  });

  it("sizes Runloop keep-alive from remaining hours and idle, capped at one hour", () => {
    assert.equal(keepAliveSecondsForPlan({ remainingHours: 10, idleMinutes: 30 }), 30 * 60);
    assert.equal(keepAliveSecondsForPlan({ remainingHours: 0.1, idleMinutes: 30 }), 15 * 60);
    assert.equal(keepAliveSecondsForPlan({ remainingHours: 40, idleMinutes: 90 }), 60 * 60);
  });
});
