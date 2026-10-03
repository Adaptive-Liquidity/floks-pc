import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ComputerService, FakeProvider, MemoryControlPlaneStore } from "../../src/lib/computers/index.ts";
import { handleStripeWebhookRequest } from "../../web/lib/billing/webhook.ts";
import { BUY_LINK_TTL_MS, createBuyLink } from "../../web/lib/billing/buy-link.ts";
import { bindFailedForEmail } from "../../web/lib/billing/bind-purchase.ts";
import { sessionFromSeats } from "../../web/lib/setup-payload.ts";
import { SETUP_RECONNECT_BOT } from "../../web/lib/copy.ts";
import type { ComputerSpec } from "../../src/lib/computers/types.ts";
import {
  MemoryPendingBindStore,
  getPendingBindStore,
  setPendingBindStoreForTests,
} from "../../web/lib/billing/pending-binds.ts";
import {
  getStripe,
  resetStripeForTests,
} from "../../web/lib/billing/stripe.ts";
import { resetStripeEventsForTests } from "../../web/lib/billing/stripe-events.ts";
import { getSeatStore, resetSeatStoreForTests } from "../../web/lib/billing/seats.ts";
import { flockIdForEmail, resetDeskRuntimeForTests, setComputerServiceForTests } from "../../web/lib/desks/runtime.ts";
import {
  MemoryOauthStore,
  exchangeCode,
  getOauthStore,
  hashToken,
  issueCode,
  pkceS256,
  registerClient,
  setOauthStoreForTests,
} from "../../web/lib/oauth.ts";
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
    setPendingBindStoreForTests(new MemoryPendingBindStore());
    setOauthStoreForTests(new MemoryOauthStore());
    setComputerServiceForTests(new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() }));
  });

  afterEach(() => {
    setComputerServiceForTests(null);
    setPendingBindStoreForTests(new MemoryPendingBindStore());
    setOauthStoreForTests(new MemoryOauthStore());
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
      const res = await handleStripeWebhookRequest(signedRequest(JSON.stringify(event), null));
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
    const first = await handleStripeWebhookRequest(signedRequest(payload, signature));
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

  it("returns 500 when provision fails so Stripe retries and bind completes on one seat", async () => {
    process.env.STAXIONS_BIND_SECRET = "test-bind-0123456789-abcdef-0123456789";
    const provider = new FakeProvider();
    provider.injectFailure("provision", "unavailable");
    setComputerServiceForTests(new ComputerService(provider, { store: new MemoryControlPlaneStore() }));

    const email = "retrybind@example.com";
    const subject = "user_retrybind";
    const client = registerClient(["https://grok.com/callback"]);
    await getOauthStore().saveClient(client);
    const verifier = "verifier-value-which-is-long-enough";
    const redirect = client.redirectUris[0] ?? "";
    const flock = flockIdForEmail(email);
    const code = await issueCode({
      clientId: client.id,
      redirectUri: redirect,
      challenge: pkceS256(verifier),
      subject,
      flock,
      email,
    });
    const exchanged = await exchangeCode({
      code,
      verifier,
      clientId: client.id,
      redirectUri: redirect,
    });
    assert.ok("token" in exchanged);
    if (!("token" in exchanged)) return;

    const link = await createBuyLink({
      origin: "https://example.test",
      email,
      subject,
      flock,
      clientId: client.id,
      plan: "personal",
    });
    const event = paidCheckoutEvent({
      id: "cs_retry_bind",
      email,
      eventId: "evt_retry_bind",
      metadata: {
        oauth_client_id: client.id,
        subject,
        flock,
        bind_nonce: link.nonce,
      },
    });
    const stripe = getStripe();
    assert.ok(stripe);
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });

    const first = await handleStripeWebhookRequest(signedRequest(payload, signature));
    assert.equal(first.status, 500);
    const afterFail = await getSeatStore().listByEmail(email);
    assert.equal(afterFail.length, 1);
    assert.equal(afterFail[0]?.computerId, null);
    assert.equal((await getPendingBindStore().get(link.nonce))?.usedAt, null);

    const retry = await handleStripeWebhookRequest(signedRequest(payload, signature));
    assert.equal(retry.status, 200);
    const seats = await getSeatStore().listByEmail(email);
    assert.equal(seats.length, 1);
    assert.ok(seats[0]?.computerId);
    assert.ok((await getPendingBindStore().get(link.nonce))?.usedAt);
    const bound = await getOauthStore().getAccess(hashToken(exchanged.token));
    assert.equal(bound?.computerId, seats[0]?.computerId);
  });

  it("returns 200 for a permanent bind failure, keeps the seat, and asks /setup to reconnect", async () => {
    process.env.STAXIONS_BIND_SECRET = "test-bind-0123456789-abcdef-0123456789";
    const email = "permbind@example.com";
    const subject = "user_permbind";
    const client = registerClient(["https://grok.com/callback"]);
    await getOauthStore().saveClient(client);
    const flock = flockIdForEmail(email);
    const link = await createBuyLink({
      origin: "https://example.test",
      email,
      subject,
      flock,
      clientId: client.id,
      plan: "personal",
      now: Date.now() - BUY_LINK_TTL_MS - 5_000,
    });
    const event = paidCheckoutEvent({
      id: "cs_perm_bind",
      email,
      eventId: "evt_perm_bind",
      metadata: {
        oauth_client_id: client.id,
        subject,
        flock,
        bind_nonce: link.nonce,
      },
    });
    const stripe = getStripe();
    assert.ok(stripe);
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const res = await handleStripeWebhookRequest(signedRequest(payload, signature));
    assert.equal(res.status, 200);
    const seats = await getSeatStore().listByEmail(email);
    assert.equal(seats.length, 1);
    assert.equal(seats[0]?.status, "active");
    assert.ok(seats[0]?.computerId);
    const pending = await getPendingBindStore().get(link.nonce);
    assert.ok(pending?.failedAt);
    assert.equal(pending?.failReason, "expired");
    assert.equal(await bindFailedForEmail(email), true);
    const session = sessionFromSeats({
      email,
      seats,
      desks: [],
      reconnectBot: await bindFailedForEmail(email),
    });
    assert.equal(session.reconnectBot, true);
    assert.match(SETUP_RECONNECT_BOT, /reconnect your bot/i);

    const replay = await handleStripeWebhookRequest(signedRequest(payload, signature));
    assert.equal(replay.status, 200);
    assert.equal(((await replay.json()) as { duplicate?: boolean }).duplicate, true);
    assert.equal((await getSeatStore().listByEmail(email)).length, 1);
  });

  it("returns 200 when checkout paid but no live login token can be bound", async () => {
    process.env.STAXIONS_BIND_SECRET = "test-bind-0123456789-abcdef-0123456789";
    const email = "nolive@example.com";
    const subject = "user_nolive";
    const client = registerClient(["https://grok.com/callback"]);
    await getOauthStore().saveClient(client);
    const flock = flockIdForEmail(email);
    const link = await createBuyLink({
      origin: "https://example.test",
      email,
      subject,
      flock,
      clientId: client.id,
      plan: "personal",
    });
    const event = paidCheckoutEvent({
      id: "cs_no_live",
      email,
      eventId: "evt_no_live",
      metadata: {
        oauth_client_id: client.id,
        subject,
        flock,
        bind_nonce: link.nonce,
      },
    });
    const stripe = getStripe();
    assert.ok(stripe);
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const res = await handleStripeWebhookRequest(signedRequest(payload, signature));
    assert.equal(res.status, 200);
    const seats = await getSeatStore().listByEmail(email);
    assert.ok(seats[0]?.computerId);
    assert.equal((await getPendingBindStore().get(link.nonce))?.failReason, "no_live_token");
    assert.equal(await bindFailedForEmail(email), true);
  });

  it("returns 409 while the first delivery is still in flight", async () => {
    process.env.STAXIONS_BIND_SECRET = "test-bind-0123456789-abcdef-0123456789";
    let release!: () => void;
    const started = Promise.withResolvers<void>();
    class HangProvision extends FakeProvider {
      override async provision(spec: ComputerSpec) {
        started.resolve();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return super.provision(spec);
      }
    }
    setComputerServiceForTests(new ComputerService(new HangProvision(), { store: new MemoryControlPlaneStore() }));

    const event = paidCheckoutEvent({ id: "cs_inflight", email: "inflight@example.com", eventId: "evt_inflight" });
    const stripe = getStripe();
    assert.ok(stripe);
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const firstP = handleStripeWebhookRequest(signedRequest(payload, signature));
    await started.promise;
    const second = await handleStripeWebhookRequest(signedRequest(payload, signature));
    assert.equal(second.status, 409);
    assert.equal(((await second.json()) as { in_flight?: boolean }).in_flight, true);
    release();
    const first = await firstP;
    assert.equal(first.status, 200);
    const seats = await getSeatStore().listByEmail("inflight@example.com");
    assert.equal(seats.length, 1);
    assert.ok(seats[0]?.computerId);
    const again = await handleStripeWebhookRequest(signedRequest(payload, signature));
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { duplicate?: boolean }).duplicate, true);
  });
});
