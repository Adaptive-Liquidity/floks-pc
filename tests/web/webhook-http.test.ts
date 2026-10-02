import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ComputerService, FakeProvider, MemoryControlPlaneStore } from "../../src/lib/computers/index.ts";
import { handleStripeWebhookRequest } from "../../web/lib/billing/webhook.ts";
import {
  getStripe,
  resetStripeForTests,
} from "../../web/lib/billing/stripe.ts";
import { resetStripeEventsForTests } from "../../web/lib/billing/stripe-events.ts";
import { getSeatStore, resetSeatStoreForTests } from "../../web/lib/billing/seats.ts";
import { resetDeskRuntimeForTests, setComputerServiceForTests } from "../../web/lib/desks/runtime.ts";
import { paidCheckoutEvent, useTestPriceEnv } from "./helpers/stripe-fixtures.ts";

const SECRET = "whsec_test_webhook_secret";

function signedRequest(payload: string, signature: string | null): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature) headers["stripe-signature"] = signature;
  return new Request("https://example.test/api/webhooks/stripe", {
    method: "POST",
    headers,
    body: payload,
  });
}

describe("stripe webhook HTTP", { concurrency: 1 }, () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    useTestPriceEnv();
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_not_a_live_key";
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    resetStripeForTests();
    resetStripeEventsForTests();
    resetSeatStoreForTests();
    resetDeskRuntimeForTests();
    setComputerServiceForTests(new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() }));
  });

  afterEach(() => {
    setComputerServiceForTests(null);
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.NODE_ENV = "test";
    resetStripeForTests();
  });

  it("refuses a missing signature in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const event = paidCheckoutEvent({ id: "cs_nosig", email: "a@example.com" });
      const pending: Promise<void>[] = [];
      const res = await handleStripeWebhookRequest(signedRequest(JSON.stringify(event), null), (work) => {
        pending.push(work());
      });
      await Promise.all(pending);
      assert.equal(res.status, 400);
      assert.equal(((await res.json()) as { ok?: boolean }).ok, false);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("refuses an invalid signature", async () => {
    const event = paidCheckoutEvent({ id: "cs_badsig", email: "b@example.com" });
    const res = await handleStripeWebhookRequest(signedRequest(JSON.stringify(event), "t=1,v1=deadbeef"));
    assert.equal(res.status, 400);
  });

  it("refuses a signed paid event in production without DATABASE_URL", async () => {
    const previous = process.env.NODE_ENV;
    const previousDb = process.env.DATABASE_URL;
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    try {
      const event = paidCheckoutEvent({ id: "cs_nodb", email: "nodb@example.com", eventId: "evt_nodb" });
      const client = getStripe();
      assert.ok(client);
      const payload = JSON.stringify(event);
      const signature = client.webhooks.generateTestHeaderString({ payload, secret: SECRET });
      const res = await handleStripeWebhookRequest(signedRequest(payload, signature));
      assert.equal(res.status, 400);
      assert.equal((await getSeatStore().listByEmail("nodb@example.com")).length, 0);
    } finally {
      if (previous === undefined) process.env.NODE_ENV = "test";
      else process.env.NODE_ENV = previous;
      if (previousDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDb;
    }
  });

  it("accepts a signed paid event once and skips the replay", async () => {
    const event = paidCheckoutEvent({ id: "cs_ok", email: "buyer@example.com", eventId: "evt_ok" });
    const client = getStripe();
    assert.ok(client);
    const payload = JSON.stringify(event);
    const signature = client.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const pending: Promise<void>[] = [];
    const first = await handleStripeWebhookRequest(signedRequest(payload, signature), (work) => {
      pending.push(work());
    });
    await Promise.all(pending);
    assert.equal(first.status, 200);
    const body = (await first.json()) as { ok?: boolean; seatId?: string | null };
    assert.equal(body.ok, true);
    assert.ok(body.seatId);
    const seat = await getSeatStore().getById(body.seatId ?? "");
    assert.equal(seat?.status, "active");
    assert.ok(seat?.computerId);

    const again = await handleStripeWebhookRequest(signedRequest(payload, signature));
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { duplicate?: boolean }).duplicate, true);
    const seats = await getSeatStore().listByEmail("buyer@example.com");
    assert.equal(seats.length, 1);
  });
});
