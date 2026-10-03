import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { applyStripeEvent, refundKindFromCharge, resetStripeForTests } from "../../web/lib/billing/stripe.ts";
import { getSeatStore, resetSeatStoreForTests } from "../../web/lib/billing/seats.ts";
import { paidCheckoutEvent, stripeEvent, useTestPriceEnv } from "./helpers/stripe-fixtures.ts";

async function paidSeat(id: string, email: string) {
  const paid = await applyStripeEvent(paidCheckoutEvent({ id, email, eventId: `evt_${id}` }));
  assert.ok(paid);
  return paid;
}

describe("refund and dispute seat policy", { concurrency: 1 }, () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    useTestPriceEnv();
    delete process.env.STRIPE_SECRET_KEY;
    resetStripeForTests();
    resetSeatStoreForTests();
  });

  it("classifies partial vs full refunds", () => {
    assert.equal(refundKindFromCharge({ amount: 2900, amount_refunded: 500, refunded: false }), "partial");
    assert.equal(refundKindFromCharge({ amount: 2900, amount_refunded: 2900, refunded: true }), "full");
    assert.equal(refundKindFromCharge({ amount_refunded: 2900 }), "full");
    assert.equal(refundKindFromCharge({ amount: 2900, amount_refunded: 0 }), "none");
  });

  it("does not change seat status on a partial refund", async () => {
    const paid = await paidSeat("cs_partial", "partial@example.com");
    const refunded = await applyStripeEvent(
      stripeEvent(
        "charge.refunded",
        { customer: "cus_cs_partial", amount: 2900, amount_refunded: 500, refunded: false },
        { id: "evt_partial", created: 1_700_000_200 },
      ),
    );
    assert.equal(refunded?.id, paid.id);
    assert.equal(refunded?.status, "active");
    assert.equal(refunded?.graceUntil, null);
    assert.equal((await getSeatStore().listByEmail("partial@example.com")).length, 1);
  });

  it("treats a full refund as canceled with grace, files kept", async () => {
    const paid = await paidSeat("cs_full", "full@example.com");
    const refunded = await applyStripeEvent(
      stripeEvent(
        "charge.refunded",
        { customer: "cus_cs_full", amount: 2900, amount_refunded: 2900, refunded: true },
        { id: "evt_full", created: 1_700_000_200 },
      ),
    );
    assert.equal(refunded?.id, paid.id);
    assert.equal(refunded?.status, "canceled");
    assert.ok(refunded?.graceUntil);
    assert.equal((await getSeatStore().getById(paid.id))?.computerIds.join(), paid.computerIds.join());
  });

  it("marks past_due when a dispute is opened", async () => {
    const paid = await paidSeat("cs_disp", "disp@example.com");
    const opened = await applyStripeEvent(
      stripeEvent(
        "charge.dispute.created",
        { customer: "cus_cs_disp", status: "needs_response" },
        { id: "evt_disp_open", created: 1_700_000_200 },
      ),
    );
    assert.equal(opened?.id, paid.id);
    assert.equal(opened?.status, "past_due");
    assert.ok(opened?.graceUntil);
  });

  it("restores active after a won dispute when the subscription is otherwise active", async () => {
    await paidSeat("cs_won", "won@example.com");
    const opened = await applyStripeEvent(
      stripeEvent(
        "charge.dispute.created",
        { customer: "cus_cs_won", status: "needs_response" },
        { id: "evt_won_open", created: 1_700_000_200 },
      ),
    );
    assert.equal(opened?.status, "past_due");
    const won = await applyStripeEvent(
      stripeEvent(
        "charge.dispute.closed",
        { customer: "cus_cs_won", status: "won" },
        { id: "evt_won_closed", created: 1_700_000_300 },
      ),
    );
    assert.equal(won?.status, "active");
    assert.equal(won?.graceUntil, null);
  });

  it("does not restore a canceled seat after a won dispute without an active subscription", async () => {
    await paidSeat("cs_keep", "keep@example.com");
    await applyStripeEvent(
      stripeEvent(
        "customer.subscription.deleted",
        {
          id: "sub_cs_keep",
          status: "canceled",
          customer: "cus_cs_keep",
          metadata: { plan: "personal" },
          items: { data: [{ price: { id: "price_personal_test" }, quantity: 1 }] },
        },
        { id: "evt_keep_del", created: 1_700_000_200 },
      ),
    );
    const won = await applyStripeEvent(
      stripeEvent(
        "charge.dispute.closed",
        { customer: "cus_cs_keep", status: "won" },
        { id: "evt_keep_won", created: 1_700_000_300 },
      ),
    );
    assert.equal(won?.status, "canceled");
  });
});
