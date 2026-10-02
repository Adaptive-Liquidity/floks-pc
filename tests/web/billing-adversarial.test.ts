import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { ComputerService, FakeProvider, MemoryControlPlaneStore } from "../../src/lib/computers/index.ts";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/tools.ts";
import { applyStripeEvent, ensureSeatFromCheckout } from "../../web/lib/billing/stripe.ts";
import { handleVerifiedStripeEvent } from "../../web/lib/billing/webhook.ts";
import { claimStripeEvent, resetStripeEventsForTests } from "../../web/lib/billing/stripe-events.ts";
import { getSeatStore, resetSeatStoreForTests } from "../../web/lib/billing/seats.ts";
import { resetDeskRuntimeForTests, setComputerServiceForTests } from "../../web/lib/desks/runtime.ts";
import {
  checkoutSessionFixture,
  paidCheckoutEvent,
  stripeEvent,
  TEST_PRICES,
  useTestPriceEnv,
} from "./helpers/stripe-fixtures.ts";

describe("adversarial stripe billing", { concurrency: 1 }, () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    useTestPriceEnv();
    resetSeatStoreForTests();
    resetStripeEventsForTests();
    resetDeskRuntimeForTests();
    setComputerServiceForTests(new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() }));
  });

  it("does not provision on an abandoned or unpaid checkout", async () => {
    const expired = await applyStripeEvent(
      stripeEvent("checkout.session.expired", checkoutSessionFixture({
        id: "cs_abandoned",
        email: "leave@example.com",
        paymentStatus: "unpaid",
      }) as unknown as Record<string, unknown>),
    );
    assert.equal(expired, null);
    const unpaidSession = checkoutSessionFixture({
      id: "cs_unpaid2",
      email: "unpaid2@example.com",
      paymentStatus: "unpaid",
    });
    const unpaidEvent = stripeEvent(
      "checkout.session.completed",
      unpaidSession as unknown as Record<string, unknown>,
      { id: "evt_unpaid2" },
    );
    assert.equal(await applyStripeEvent(unpaidEvent), null);
    const omitted = checkoutSessionFixture({
      id: "cs_nopay",
      email: "nopay@example.com",
    });
    delete (omitted as { payment_status?: string }).payment_status;
    assert.equal(
      await applyStripeEvent(
        stripeEvent("checkout.session.completed", omitted as unknown as Record<string, unknown>, {
          id: "evt_nopay",
        }),
      ),
      null,
    );
    assert.equal((await getSeatStore().listByEmail("leave@example.com")).length, 0);
    assert.equal((await getSeatStore().listByEmail("unpaid2@example.com")).length, 0);
    assert.equal((await getSeatStore().listByEmail("nopay@example.com")).length, 0);
  });

  it("refuses a price id that is not in env even when metadata names a plan", async () => {
    const event = paidCheckoutEvent({
      id: "cs_mismatch",
      email: "mismatch@example.com",
      plan: "personal",
      priceId: "price_not_in_env",
    });
    assert.equal(await applyStripeEvent(event), null);
    assert.equal((await getSeatStore().listByEmail("mismatch@example.com")).length, 0);
  });

  it("provisions a computer only after a confirmed paid event", async () => {
    const created = await handleVerifiedStripeEvent(
      stripeEvent(
        "customer.subscription.created",
        {
          id: "sub_incomplete",
          status: "incomplete",
          customer: { id: "cus_inc", email: "inc@example.com" },
          metadata: { plan: "personal" },
          items: { data: [{ price: { id: TEST_PRICES.personal }, quantity: 1 }] },
        },
        { id: "evt_incomplete", created: 1_700_000_000 },
      ),
    );
    assert.equal(created.seat, null);

    const paid = await handleVerifiedStripeEvent(
      paidCheckoutEvent({
        id: "cs_inc",
        email: "inc@example.com",
        eventId: "evt_paid_inc",
        created: 1_700_000_100,
      }),
    );
    assert.equal(paid.duplicate, false);
    assert.ok(paid.seat?.computerId);
    assert.equal(paid.seat?.status, "active");
    const stored = await getSeatStore().getById(paid.seat.id);
    assert.equal(stored?.computerId, paid.seat.computerId);
  });

  it("keeps a reused checkout session on the original buyer", async () => {
    const first = await applyStripeEvent(
      paidCheckoutEvent({ id: "cs_reuse", email: "first@example.com", eventId: "evt_reuse_1" }),
    );
    const again = await applyStripeEvent(
      paidCheckoutEvent({ id: "cs_reuse", email: "first@example.com", eventId: "evt_reuse_2" }),
    );
    assert.equal(first?.id, again?.id);
    assert.equal((await getSeatStore().listByEmail("first@example.com")).length, 1);
  });

  it("refuses in-memory Stripe event ids when production has no DATABASE_URL", async () => {
    const previous = process.env.NODE_ENV;
    const previousDb = process.env.DATABASE_URL;
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    try {
      await assert.rejects(
        () => claimStripeEvent("evt_prod_memory", "checkout.session.completed"),
        /DATABASE_URL/,
      );
    } finally {
      process.env.NODE_ENV = previous === undefined ? "test" : previous;
      if (previousDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDb;
    }
  });

  it("keeps the MCP surface at exactly eight tools", () => {
    assert.equal(MCP_TOOL_NAMES.length, 8);
    assert.equal(MCP_TOOL_NAMES.includes("computer_destroy" as never), false);
  });

  it("is idempotent on event id and safe on out-of-order replay", async () => {
    const paid = paidCheckoutEvent({
      id: "cs_order",
      email: "order@example.com",
      eventId: "evt_order_paid",
      created: 1_700_000_500,
    });
    const first = await handleVerifiedStripeEvent(paid);
    const replay = await handleVerifiedStripeEvent(paid);
    assert.equal(replay.duplicate, true);
    assert.equal((await getSeatStore().listByEmail("order@example.com")).length, 1);

    const staleFail = await applyStripeEvent(
      stripeEvent(
        "invoice.payment_failed",
        { subscription: "sub_cs_order", customer: "cus_cs_order" },
        { id: "evt_order_fail_old", created: 1_700_000_100 },
      ),
    );
    assert.equal(staleFail?.status, "active");
    assert.equal(staleFail?.id, first.seat?.id);

    const deleted = await applyStripeEvent(
      stripeEvent(
        "customer.subscription.deleted",
        {
          id: "sub_cs_order",
          status: "canceled",
          customer: "cus_cs_order",
          metadata: { plan: "personal" },
          items: { data: [{ price: { id: TEST_PRICES.personal }, quantity: 1 }] },
        },
        { id: "evt_order_del", created: 1_700_000_800 },
      ),
    );
    assert.equal(deleted?.status, "canceled");
    const lateCheckout = await applyStripeEvent(
      paidCheckoutEvent({
        id: "cs_order",
        email: "order@example.com",
        eventId: "evt_order_late",
        created: 1_700_000_200,
      }),
    );
    assert.equal(lateCheckout?.status, "canceled");
  });

  it("marks past_due on failure, resumes on retry, and holds refunds and lost disputes", async () => {
    const paid = await applyStripeEvent(
      paidCheckoutEvent({ id: "cs_retry", email: "retry@example.com", eventId: "evt_retry_paid" }),
    );
    assert.ok(paid);
    const failed = await applyStripeEvent(
      stripeEvent(
        "invoice.payment_failed",
        { subscription: "sub_cs_retry", customer: "cus_cs_retry" },
        { id: "evt_retry_fail", created: 1_700_000_200 },
      ),
    );
    assert.equal(failed?.status, "past_due");
    assert.ok(failed?.graceUntil);
    const retried = await applyStripeEvent(
      stripeEvent(
        "invoice.paid",
        { subscription: "sub_cs_retry", customer: "cus_cs_retry" },
        { id: "evt_retry_paid2", created: 1_700_000_300 },
      ),
    );
    assert.equal(retried?.status, "active");
    assert.equal(retried?.graceUntil, null);

    const refunded = await applyStripeEvent(
      stripeEvent(
        "charge.refunded",
        { customer: "cus_cs_retry", amount_refunded: 2900 },
        { id: "evt_refund", created: 1_700_000_400 },
      ),
    );
    assert.equal(refunded?.status, "past_due");
    const disputed = await applyStripeEvent(
      stripeEvent(
        "charge.dispute.created",
        { customer: "cus_cs_retry", status: "needs_response" },
        { id: "evt_dispute", created: 1_700_000_500 },
      ),
    );
    assert.equal(disputed?.status, "past_due");
    const won = await applyStripeEvent(
      stripeEvent(
        "charge.dispute.closed",
        { customer: "cus_cs_retry", status: "won" },
        { id: "evt_won", created: 1_700_000_600 },
      ),
    );
    assert.equal(won?.status, "past_due");
  });

  it("creates a new seat after cancel when the buyer purchases again", async () => {
    const first = await applyStripeEvent(
      paidCheckoutEvent({ id: "cs_old", email: "again@example.com", eventId: "evt_old" }),
    );
    await applyStripeEvent(
      stripeEvent(
        "customer.subscription.deleted",
        {
          id: "sub_cs_old",
          status: "canceled",
          customer: "cus_cs_old",
          items: { data: [{ price: { id: TEST_PRICES.personal }, quantity: 1 }] },
        },
        { id: "evt_old_del", created: 1_700_000_200 },
      ),
    );
    const second = await applyStripeEvent(
      paidCheckoutEvent({ id: "cs_new", email: "again@example.com", eventId: "evt_new", created: 1_700_000_300 }),
    );
    assert.ok(first && second);
    assert.notEqual(first.id, second.id);
    assert.equal(second.status, "active");
    const rows = await getSeatStore().listByEmail("again@example.com");
    assert.equal(rows.length, 2);
  });

  it("does not attach another customer's checkout to a different signed-in user", async () => {
    await applyStripeEvent(paidCheckoutEvent({ id: "cs_owner", email: "owner@example.com" }));
    assert.equal(await ensureSeatFromCheckout("cs_owner", "intruder@example.com"), null);
    assert.equal(await ensureSeatFromCheckout("cs_missing", "owner@example.com"), null);
  });
});
