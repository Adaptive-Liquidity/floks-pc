import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import type Stripe from "stripe";
import { applyStripeEvent } from "../../web/lib/billing/stripe.ts";
import { resetSeatStoreForTests, seatStoreFromEnv } from "../../web/lib/billing/seats.ts";

describe("stripe webhook entitlements", () => {
  beforeEach(() => {
    resetSeatStoreForTests();
    process.env.STRIPE_PRICE_PERSONAL = "price_personal_test";
    process.env.STRIPE_PRICE_PRO = "price_pro_test";
    process.env.STRIPE_PRICE_TEAM = "price_team_test";
  });

  it("creates a Personal seat from checkout.session.completed via price id", async () => {
    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_personal",
          amount_total: 1900,
          customer: "cus_p",
          customer_email: "Buyer@Example.com",
          customer_details: { email: "Buyer@Example.com" },
          subscription: "sub_p",
          payment_status: "paid",
          created: 1_700_000_000,
          metadata: { plan: "personal", price_id: "price_personal_test", agent_quantity: "1" },
          line_items: { data: [{ price: { id: "price_personal_test" }, quantity: 1 }] },
        },
      },
    } as Stripe.Event;
    const seat = await applyStripeEvent(event);
    assert.ok(seat);
    assert.equal(seat.plan, "personal");
    assert.equal(seat.hoursIncluded, 10);
    assert.equal(seat.maxComputers, 1);
    assert.equal(seat.email, "buyer@example.com");
    const again = await applyStripeEvent(event);
    assert.equal(again?.id, seat.id);
  });

  it("creates a Team seat with min-3 quantity and pooled hours from the price id", async () => {
    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_team",
          amount_total: 6900,
          customer: "cus_t",
          customer_details: { email: "team@example.com" },
          subscription: "sub_t",
          payment_status: "paid",
          created: 1_700_000_000,
          metadata: { plan: "team", price_id: "price_team_test", agent_quantity: "4" },
          line_items: { data: [{ price: { id: "price_team_test" }, quantity: 4 }] },
        },
      },
    } as Stripe.Event;
    const seat = await applyStripeEvent(event);
    assert.ok(seat);
    assert.equal(seat.plan, "team");
    assert.equal(seat.agentQuantity, 4);
    assert.equal(seat.maxComputers, 4);
    assert.equal(seat.hoursIncluded, 120);
  });

  it("marks a seat past_due on invoice.payment_failed and canceled on subscription.deleted", async () => {
    const seat = await applyStripeEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_fail",
          amount_total: 9900,
          customer: "cus_f",
          customer_details: { email: "fail@example.com" },
          subscription: "sub_f",
          payment_status: "paid",
          created: 1_700_000_000,
          metadata: { plan: "pro", price_id: "price_pro_test" },
          line_items: { data: [{ price: { id: "price_pro_test" }, quantity: 1 }] },
        },
      },
    } as Stripe.Event);
    assert.ok(seat);
    const failed = await applyStripeEvent({
      type: "invoice.payment_failed",
      data: { object: { subscription: "sub_f", customer: "cus_f" } },
    } as Stripe.Event);
    assert.equal(failed?.id, seat.id);
    assert.equal(failed?.status, "past_due");
    const failedV18 = await applyStripeEvent({
      type: "invoice.payment_failed",
      data: {
        object: {
          parent: { subscription_details: { subscription: "sub_f" } },
          customer: "cus_f",
        },
      },
    } as Stripe.Event);
    assert.equal(failedV18?.id, seat.id);
    const canceled = await applyStripeEvent({
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_f",
          status: "canceled",
          customer: "cus_f",
          metadata: { plan: "pro" },
          items: { data: [{ price: { id: "price_pro_test" }, quantity: 1 }] },
        },
      },
    } as Stripe.Event);
    assert.equal(canceled?.status, "canceled");
  });

  it("keeps a Team quantity below 3 when the portal lowers it and activates on invoice.paid", async () => {
    const created = await applyStripeEvent({
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_team",
          status: "active",
          customer: { id: "cus_team", email: "team@example.com" },
          customer_email: "team@example.com",
          metadata: { plan: "team" },
          items: { data: [{ price: { id: "price_team_test" }, quantity: 2 }] },
        },
      },
    } as unknown as Stripe.Event);
    assert.equal(created?.agentQuantity, 2);
    assert.equal(created?.maxComputers, 2);
    assert.equal(created?.hoursIncluded, 60);
    const paid = await applyStripeEvent({
      type: "invoice.paid",
      data: {
        object: {
          customer: "cus_team",
          parent: { subscription_details: { subscription: "sub_team" } },
          lines: { data: [{ quantity: 2 }] },
        },
      },
    } as unknown as Stripe.Event);
    assert.equal(paid?.status, "active");
    assert.equal(paid?.agentQuantity, 2);
  });

  it("does not revive a canceled seat or take Team quantity from invoice lines", async () => {
    const created = await applyStripeEvent({
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_keep",
          status: "active",
          customer: { id: "cus_keep", email: "keep@example.com" },
          metadata: { plan: "team" },
          items: { data: [{ price: { id: "price_team_test" }, quantity: 2 }] },
        },
      },
    } as unknown as Stripe.Event);
    assert.equal(created?.agentQuantity, 2);
    const canceled = await applyStripeEvent({
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_keep",
          status: "canceled",
          customer: "cus_keep",
          metadata: { plan: "team" },
          items: { data: [{ price: { id: "price_team_test" }, quantity: 2 }] },
        },
      },
    } as unknown as Stripe.Event);
    assert.equal(canceled?.status, "canceled");
    const paid = await applyStripeEvent({
      type: "invoice.paid",
      data: {
        object: {
          customer: "cus_keep",
          parent: { subscription_details: { subscription: "sub_keep" } },
          lines: { data: [{ quantity: 9 }] },
        },
      },
    } as unknown as Stripe.Event);
    assert.equal(paid?.status, "canceled");
    assert.equal(paid?.agentQuantity, 2);
  });

  it("refuses a silent memory fallback when production has no DATABASE_URL", () => {
    assert.throws(
      () => seatStoreFromEnv({ NODE_ENV: "production" }),
      /DATABASE_URL/,
    );
    assert.throws(
      () => seatStoreFromEnv({ VERCEL: "1", NODE_ENV: "development" }),
      /DATABASE_URL/,
    );
  });
});
