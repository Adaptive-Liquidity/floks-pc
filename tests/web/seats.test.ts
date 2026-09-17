import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  MemorySeatStore,
  createSeat,
  getSeatStore,
  periodLabel,
  resetSeatStoreForTests,
} from "../../web/lib/billing/seats.ts";
import { sessionFromSeats } from "../../web/lib/setup-payload.ts";
import { applyStripeEvent, ensureSeatFromCheckout } from "../../web/lib/billing/stripe.ts";
import type Stripe from "stripe";

describe("seat ledger", () => {
  beforeEach(() => {
    resetSeatStoreForTests();
  });

  it("does not invent a seat for a signed-in email", async () => {
    const store = new MemorySeatStore();
    const empty = await store.listByEmail("owner@example.com");
    assert.equal(empty.length, 0);
    const session = sessionFromSeats({ email: "owner@example.com", seats: [], desks: [] });
    assert.equal(session.seats, 0);
    assert.equal(session.desk, null);
    assert.equal(session.plan, null);
  });

  it("stores emails lowercase and looks them up case-insensitively", async () => {
    const store = new MemorySeatStore();
    const seat = await store.upsert(
      createSeat({
        email: "Owner@Example.COM",
        plan: "desk",
        stripeCustomerId: "cus_1",
        stripeCheckoutSessionId: "cs_1",
      }),
    );
    assert.equal(seat.email, "owner@example.com");
    assert.equal(seat.hoursIncluded, 25);
    const found = await store.listByEmail("OWNER@example.com");
    assert.equal(found.length, 1);
    assert.equal(periodLabel({ ...seat, periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-10-01T00:00:00Z" }), "2026-09-01 – 2026-10-01");
  });

  it("creates a seat from a checkout.session.completed event once", async () => {
    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_live_1",
          amount_total: 3900,
          customer: "cus_live_1",
          customer_email: "Pay@Example.com",
          customer_details: { email: "Pay@Example.com" },
          subscription: "sub_live_1",
          created: 1_700_000_000,
        },
      },
    } as Stripe.Event;
    const first = await applyStripeEvent(event);
    const second = await applyStripeEvent(event);
    assert.ok(first);
    assert.equal(first.plan, "desk");
    assert.equal(first.email, "pay@example.com");
    assert.equal(second?.id, first.id);
  });

  it("does not attach another customer's checkout seat to a signed-in email", async () => {
    const store = getSeatStore();
    await store.upsert(
      createSeat({
        email: "other@example.com",
        plan: "spark",
        stripeCustomerId: "cus_other",
        stripeCheckoutSessionId: "cs_other",
      }),
    );
    assert.equal(await ensureSeatFromCheckout("cs_other", "signed-in@example.com"), null);
    assert.equal(await ensureSeatFromCheckout("cs_missing", "signed-in@example.com"), null);
  });
});
