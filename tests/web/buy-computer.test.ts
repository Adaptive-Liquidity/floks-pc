import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type Stripe from "stripe";
import { ComputerService, FakeProvider, MemoryControlPlaneStore } from "../../src/lib/computers/index.ts";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/tools.ts";
import { GET as buyGet, POST as buyPost } from "../../web/app/buy/route.ts";
import { POST as disconnectPost } from "../../web/app/api/setup/disconnect/route.ts";
import { middleware } from "../../web/middleware.ts";
import { POST as mcpPost } from "../../web/app/mcp/route.ts";
import { GET as authorizeGet, POST as authorizePost } from "../../web/app/oauth/authorize/route.ts";
import { resetStripeForTests } from "../../web/lib/billing/stripe.ts";
import { bindPurchasedComputer } from "../../web/lib/billing/bind-purchase.ts";
import {
  BUY_LINK_TTL_MS,
  NO_COMPUTER_MESSAGE,
  createBuyLink,
  readBuyToken,
} from "../../web/lib/billing/buy-link.ts";
import { provisionSeatComputers, shutdownSeatComputers } from "../../web/lib/billing/lifecycle.ts";
import { openBuyToken } from "../../web/lib/billing/buy-link.ts";
import { MemoryPendingBindStore, getPendingBindStore, setPendingBindStoreForTests } from "../../web/lib/billing/pending-binds.ts";
import { applyStripeEvent } from "../../web/lib/billing/stripe.ts";
import { createSeat, getSeatStore, resetSeatStoreForTests } from "../../web/lib/billing/seats.ts";
import { OAUTH_NO_COMPUTER } from "../../web/lib/copy.ts";
import { flockIdForEmail, setComputerServiceForTests } from "../../web/lib/desks/runtime.ts";
import {
  MemoryOauthStore,
  exchangeCode,
  getOauthStore,
  hashToken,
  issueCode,
  pkceS256,
  refreshAccess,
  registerClient,
  setOauthStoreForTests,
} from "../../web/lib/oauth.ts";
import { resetRateLimitsForTests } from "../../web/lib/rate-limit.ts";

const ORIGIN = "https://staxions-preview.vercel.app";
const EMAIL = "buyer@example.com";
const SUBJECT = "user_buyer";

function useBindKey(): void {
  process.env.STAXIONS_BIND_SECRET = ["test-bind-", "0123456789-abcdef-0123456789"].join("");
}

function userHeader(id: string, email: string): string {
  return JSON.stringify({ id, email });
}

async function allowForm(input: {
  clientId: string;
  redirect: string;
  challenge: string;
  email: string;
  subject: string;
  ip: string;
  computerId?: string;
}): Promise<Response> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirect,
    code_challenge: input.challenge,
    allow: "1",
  });
  if (input.computerId) body.set("computer_id", input.computerId);
  return authorizePost(
    new Request(`${ORIGIN}/oauth/authorize`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": input.ip,
        "x-stax-test-user": userHeader(input.subject, input.email),
      },
      body,
    }),
  );
}

async function freshToken(email: string, subject: string): Promise<{ token: string; clientId: string; flock: string }> {
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
  const exchanged = await exchangeCode({ code, verifier, clientId: client.id, redirectUri: redirect });
  if (!("token" in exchanged)) throw new Error("token exchange failed");
  return { token: exchanged.token, clientId: client.id, flock };
}

async function callTool(
  token: string,
  name: string,
  args: Record<string, unknown>,
  id = 1,
): Promise<{ status: number; isError: boolean; structuredContent: Record<string, unknown> }> {
  const res = await mcpPost(
    new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "mcp-protocol-version": "2026-07-28",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  const json = (await res.json()) as {
    result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
  };
  return {
    status: res.status,
    isError: json.result?.isError === true,
    structuredContent: json.result?.structuredContent ?? {},
  };
}

function checkoutEvent(
  id: string,
  email: string,
  metadata: Record<string, string>,
): Stripe.Event {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id,
        customer: `cus_${id}`,
        customer_email: email,
        customer_details: { email },
        subscription: `sub_${id}`,
        created: 1_700_000_000,
        metadata: { plan: "personal", price_id: "price_personal_test", agent_quantity: "1", ...metadata },
        line_items: { data: [{ price: { id: "price_personal_test" }, quantity: 1 }] },
      },
    },
  } as Stripe.Event;
}

describe("buy a computer from the bot", { concurrency: 1 }, () => {
  it("lets Allow issue a token with no computer", async () => {
    process.env.STAX_TEST_AUTH = "1";
    resetRateLimitsForTests();
    resetSeatStoreForTests();
    setOauthStoreForTests(new MemoryOauthStore());
    const client = registerClient(["https://grok.com/callback"]);
    await getOauthStore().saveClient(client);
    const redirect = client.redirectUris[0] ?? "";
    const query = new URLSearchParams({
      client_id: client.id,
      redirect_uri: redirect,
      code_challenge: pkceS256("verifier-value-which-is-long-enough"),
    });
    const preflight = await authorizeGet(
      new Request(`${ORIGIN}/oauth/authorize?${query}`, {
        headers: {
          accept: "application/json",
          "x-forwarded-for": "203.0.113.20",
          "x-stax-test-user": userHeader(SUBJECT, EMAIL),
        },
      }),
    );
    assert.equal(preflight.status, 200);
    const body = (await preflight.json()) as { status?: string; needs_computer?: boolean };
    assert.equal(body.status, "ready");
    assert.equal(body.needs_computer, true);
    const card = readFileSync(new URL("../../web/components/AuthorizeCard.tsx", import.meta.url), "utf8");
    assert.match(card, /OAUTH_NO_COMPUTER/);
    assert.equal(OAUTH_NO_COMPUTER, "No computer yet. Your Bot can get you one after you connect.");

    const posted = await allowForm({
      clientId: client.id,
      redirect,
      challenge: pkceS256("verifier-value-which-is-long-enough"),
      email: EMAIL,
      subject: SUBJECT,
      ip: "203.0.113.21",
    });
    assert.equal(posted.status, 303);
    const code = new URL(posted.headers.get("location") ?? "").searchParams.get("code");
    assert.ok(code);
    const exchanged = await exchangeCode({
      code: code ?? "",
      verifier: "verifier-value-which-is-long-enough",
      clientId: client.id,
      redirectUri: redirect,
    });
    assert.ok("token" in exchanged);
    if (!("token" in exchanged)) return;
    const row = await getOauthStore().getAccess(hashToken(exchanged.token));
    assert.equal(row?.computerId, null);
    assert.equal(row?.subject, SUBJECT);
  });

  it("keeps the computer picker when the account already has one", async () => {
    process.env.STAX_TEST_AUTH = "1";
    resetRateLimitsForTests();
    resetSeatStoreForTests();
    setOauthStoreForTests(new MemoryOauthStore());
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    setComputerServiceForTests(service);
    const computer = await service.requestComputer({
      birdId: "seat:picker",
      flockId: flockIdForEmail(EMAIL),
    });
    await getSeatStore().upsert(
      createSeat({
        email: EMAIL,
        plan: "personal",
        stripeCustomerId: "cus_picker",
        computerId: computer.id,
        computerIds: [computer.id],
      }),
    );
    const client = registerClient(["https://grok.com/callback"]);
    await getOauthStore().saveClient(client);
    const redirect = client.redirectUris[0] ?? "";
    const challenge = pkceS256("verifier-value-which-is-long-enough");
    const preflight = await authorizeGet(
      new Request(
        `${ORIGIN}/oauth/authorize?${new URLSearchParams({ client_id: client.id, redirect_uri: redirect, code_challenge: challenge })}`,
        {
          headers: {
            accept: "application/json",
            "x-forwarded-for": "203.0.113.22",
            "x-stax-test-user": userHeader(SUBJECT, EMAIL),
          },
        },
      ),
    );
    const listed = (await preflight.json()) as { computers?: Array<{ id: string; label?: string }> };
    assert.equal(listed.computers?.[0]?.id, computer.id);
    assert.equal(listed.computers?.[0]?.label, "Computer 1");
    const tampered = await allowForm({
      clientId: client.id,
      redirect,
      challenge,
      email: EMAIL,
      subject: SUBJECT,
      ip: "203.0.113.23",
      computerId: "cmp_other",
    });
    assert.equal(tampered.status, 303);
    assert.match(tampered.headers.get("location") ?? "", /\/oauth\/consent/);
    const picked = await allowForm({
      clientId: client.id,
      redirect,
      challenge,
      email: EMAIL,
      subject: SUBJECT,
      ip: "203.0.113.24",
      computerId: computer.id,
    });
    const code = new URL(picked.headers.get("location") ?? "").searchParams.get("code");
    const exchanged = await exchangeCode({
      code: code ?? "",
      verifier: "verifier-value-which-is-long-enough",
      clientId: client.id,
      redirectUri: redirect,
    });
    assert.ok("token" in exchanged);
    if (!("token" in exchanged)) return;
    assert.equal((await getOauthStore().getAccess(hashToken(exchanged.token)))?.computerId, computer.id);
  });

  it("returns a checkout link from computer_pair and changes it with plan", async () => {
    useBindKey();
    resetSeatStoreForTests();
    setOauthStoreForTests(new MemoryOauthStore());
    setPendingBindStoreForTests(new MemoryPendingBindStore());
    const { token } = await freshToken(EMAIL, SUBJECT);
    const listed = await mcpPost(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "mcp-protocol-version": "2026-07-28",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    const tools = (await listed.json()) as {
      result?: { tools?: Array<{ name: string; inputSchema?: { required?: string[] } }> };
    };
    assert.deepEqual(
      tools.result?.tools?.map((tool) => tool.name),
      [...MCP_TOOL_NAMES],
    );
    assert.equal(MCP_TOOL_NAMES.length, 8);
    const pairSchema = tools.result?.tools?.find((tool) => tool.name === "computer_pair")?.inputSchema;
    assert.deepEqual(pairSchema?.required ?? [], []);

    const personal = await callTool(token, "computer_pair", {});
    assert.equal(personal.isError, false);
    assert.equal(personal.structuredContent.connected, false);
    assert.equal(personal.structuredContent.needs_purchase, true);
    assert.equal(personal.structuredContent.message, NO_COMPUTER_MESSAGE);
    const personalUrl = String(personal.structuredContent.checkout_url);
    assert.match(personalUrl, /\/buy\?t=/);
    assert.equal(readBuyToken(new URL(personalUrl).searchParams.get("t") ?? "")?.plan, "personal");

    const pro = await callTool(token, "computer_pair", { plan: "pro" }, 2);
    assert.equal(pro.isError, false);
    assert.equal(readBuyToken(new URL(String(pro.structuredContent.checkout_url)).searchParams.get("t") ?? "")?.plan, "pro");

    const exec = await callTool(token, "computer_exec", {}, 3);
    assert.equal(exec.isError, true);
    assert.equal(exec.structuredContent.message, "No computer yet. Call computer_pair to get one.");

    await getSeatStore().upsert(
      createSeat({
        email: EMAIL,
        plan: "personal",
        stripeCustomerId: "cus_owned",
        computerId: "cmp_owned",
        computerIds: ["cmp_owned"],
      }),
    );
    const reconnect = await callTool(token, "computer_status", {}, 4);
    assert.equal(reconnect.isError, true);
    assert.equal(
      reconnect.structuredContent.message,
      "Reconnect Staxions in Grok and pick a computer on the Allow screen.",
    );
  });

  it("expires a signed buy link after 30 minutes and refuses a second open", async () => {
    useBindKey();
    setPendingBindStoreForTests(new MemoryPendingBindStore());
    const expired = await createBuyLink({
      origin: ORIGIN,
      email: EMAIL,
      subject: SUBJECT,
      flock: flockIdForEmail(EMAIL),
      clientId: "stax_client",
      plan: "personal",
      now: Date.now() - BUY_LINK_TTL_MS - 1_000,
    });
    const stale = await buyGet(new Request(expired.url));
    assert.equal(stale.status, 400);
    assert.equal(((await stale.json()) as { error?: string }).error, "expired");

    const previousKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    resetStripeForTests();
    try {
      const fresh = await createBuyLink({
        origin: ORIGIN,
        email: EMAIL,
        subject: SUBJECT,
        flock: flockIdForEmail(EMAIL),
        clientId: "stax_client",
        plan: "team",
      });
      const preview = await buyGet(new Request(fresh.url));
      assert.equal(preview.status, 200);
      assert.match(await preview.text(), /Confirm purchase/);
      const again = await buyGet(new Request(fresh.url));
      assert.equal(again.status, 200);
      const token = new URL(fresh.url).searchParams.get("t") ?? "";
      const posted = await buyPost(
        new Request(fresh.url, {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ t: token }),
        }),
      );
      assert.equal(posted.status, 503);
      const reused = await buyPost(
        new Request(fresh.url, {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ t: token }),
        }),
      );
      assert.equal(reused.status, 400);
      assert.equal(((await reused.json()) as { error?: string }).error, "used");
    } finally {
      if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previousKey;
      resetStripeForTests();
    }
  });

  it("binds a paid computer to the bot and ignores tampered checkout metadata", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousPrice = process.env.STRIPE_PRICE_PERSONAL;
    process.env.NODE_ENV = "test";
    useBindKey();
    process.env.STRIPE_PRICE_PERSONAL = "price_personal_test";
    resetSeatStoreForTests();
    setOauthStoreForTests(new MemoryOauthStore());
    setPendingBindStoreForTests(new MemoryPendingBindStore());
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    setComputerServiceForTests(service);
    try {
      const { token, clientId, flock } = await freshToken(EMAIL, SUBJECT);
      const link = await createBuyLink({
        origin: ORIGIN,
        email: EMAIL,
        subject: SUBJECT,
        flock,
        clientId,
        plan: "personal",
      });
      const event = checkoutEvent("cs_bind", EMAIL, {
        oauth_client_id: clientId,
        subject: SUBJECT,
        flock,
        bind_nonce: link.nonce,
      });
      const seat = await applyStripeEvent(event);
      assert.ok(seat);
      const computers = await provisionSeatComputers(seat);
      assert.equal(computers.length > 0, true);
      assert.equal(await bindPurchasedComputer(event, seat, computers), true);
      const bound = await getOauthStore().getAccess(hashToken(token));
      assert.equal(bound?.computerId, computers[0]?.id);
      const status = await callTool(token, "computer_status", {});
      assert.equal(status.isError, false);
      assert.equal(status.structuredContent.connected, true);
      assert.equal(status.structuredContent.computer_handle, computers[0]?.id);

      const cases: Array<{ name: string; email: string; metadata: Record<string, string> }> = [
        {
          name: "wrong subject",
          email: "wrong-subject@example.com",
          metadata: { subject: "user_other" },
        },
        {
          name: "wrong flock",
          email: "wrong-flock@example.com",
          metadata: { flock: "owner:not-this-flock" },
        },
        {
          name: "unknown nonce",
          email: "unknown-nonce@example.com",
          metadata: { bind_nonce: "missing-nonce" },
        },
        {
          name: "used nonce",
          email: "used-nonce@example.com",
          metadata: {},
        },
      ];
      for (const [index, item] of cases.entries()) {
        const subject = `user_${index}`;
        const issued = await freshToken(item.email, subject);
        const pending = await createBuyLink({
          origin: ORIGIN,
          email: item.email,
          subject,
          flock: issued.flock,
          clientId: issued.clientId,
          plan: "personal",
        });
        const metadata = {
          oauth_client_id: issued.clientId,
          subject,
          flock: issued.flock,
          bind_nonce: pending.nonce,
          ...item.metadata,
        };
        if (item.name === "used nonce") {
          assert.equal(await getPendingBindStore().markUsed(pending.nonce), true);
        }
        const tampered = checkoutEvent(`cs_tamper_${index}`, item.email, metadata);
        const tamperSeat = await applyStripeEvent(tampered);
        assert.ok(tamperSeat, item.name);
        const created = await provisionSeatComputers(tamperSeat);
        assert.equal(created.length > 0, true, item.name);
        assert.equal(await bindPurchasedComputer(tampered, tamperSeat, created), false, item.name);
        const row = await getOauthStore().getAccess(hashToken(issued.token));
        assert.equal(row?.computerId, null, item.name);
        const saved = await getSeatStore().getById(tamperSeat.id);
        assert.equal(saved?.computerId, created[0]?.id, item.name);
      }
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousPrice === undefined) delete process.env.STRIPE_PRICE_PERSONAL;
      else process.env.STRIPE_PRICE_PERSONAL = previousPrice;
      setComputerServiceForTests(null);
    }
  });

  it("drives a bound computer with only the OAuth bearer", async () => {
    process.env.NODE_ENV = "test";
    process.env.STAX_TEST_AUTH = "1";
    useBindKey();
    resetSeatStoreForTests();
    setOauthStoreForTests(new MemoryOauthStore());
    setPendingBindStoreForTests(new MemoryPendingBindStore());
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    setComputerServiceForTests(service);
    const flock = flockIdForEmail(EMAIL);
    const computer = await service.requestComputer({ birdId: "seat:picker", flockId: flock });
    await getSeatStore().upsert(
      createSeat({
        email: EMAIL,
        plan: "personal",
        stripeCustomerId: "cus_drive",
        computerId: computer.id,
        computerIds: [computer.id],
      }),
    );
    const client = registerClient(["https://grok.com/callback"], "Grok");
    await getOauthStore().saveClient(client);
    const redirect = client.redirectUris[0] ?? "";
    const verifier = "verifier-value-which-is-long-enough";
    const allowed = await allowForm({
      clientId: client.id,
      redirect,
      challenge: pkceS256(verifier),
      email: EMAIL,
      subject: SUBJECT,
      ip: "203.0.113.40",
    });
    const code = new URL(allowed.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const exchanged = await exchangeCode({ code, verifier, clientId: client.id, redirectUri: redirect });
    assert.ok("token" in exchanged);
    if (!("token" in exchanged)) return;
    await drive(exchanged.token);
    const wrongHandle = await callTool(exchanged.token, "computer_exec", {
      argv: ["uname", "-s"],
      computer_handle: "computer_other",
      capability_token: "not-the-bound-secret",
    });
    assert.equal(wrongHandle.isError, false);

    const other = registerClient(["https://grok.com/callback"], "Other Bot");
    await getOauthStore().saveClient(other);
    const otherRedirect = other.redirectUris[0] ?? "";
    const taken = await allowForm({
      clientId: other.id,
      redirect: otherRedirect,
      challenge: pkceS256(verifier),
      email: EMAIL,
      subject: SUBJECT,
      ip: "203.0.113.41",
      computerId: computer.id,
    });
    const takenCode = new URL(taken.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const second = await exchangeCode({
      code: takenCode,
      verifier,
      clientId: other.id,
      redirectUri: otherRedirect,
    });
    assert.ok("token" in second);
    if (!("token" in second)) return;
    const firstExec = await callTool(exchanged.token, "computer_exec", { argv: ["uname", "-s"] });
    assert.equal(firstExec.status === 401 || firstExec.isError, true);
    await drive(second.token);

    const refreshed = await refreshAccess(second.refresh, other.id);
    assert.ok("token" in refreshed);
    if (!("token" in refreshed)) return;
    assert.equal((await getOauthStore().getAccess(hashToken(refreshed.token)))?.computerId, computer.id);
    const wrongClient = await refreshAccess(refreshed.refresh, client.id);
    assert.deepEqual(wrongClient, { error: "invalid_grant" });
    await service.revokeCapability((await getOauthStore().getAccess(hashToken(refreshed.token)))?.capabilityId ?? "");
    const dead = await refreshAccess(refreshed.refresh, other.id);
    assert.deepEqual(dead, { error: "invalid_grant" });
  });

  it("runs the purchased computer from the OAuth bearer and keeps a slow checkout", async () => {
    process.env.NODE_ENV = "test";
    process.env.STRIPE_PRICE_PERSONAL = "price_personal_test";
    useBindKey();
    resetSeatStoreForTests();
    setOauthStoreForTests(new MemoryOauthStore());
    setPendingBindStoreForTests(new MemoryPendingBindStore());
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    setComputerServiceForTests(service);
    const { token, clientId, flock } = await freshToken("paid@example.com", "user_paid");
    const started = Date.now() - 40 * 60 * 1000;
    const link = await createBuyLink({
      origin: ORIGIN,
      email: "paid@example.com",
      subject: "user_paid",
      flock,
      clientId,
      plan: "personal",
      now: started,
    });
    const signed = new URL(link.url).searchParams.get("t") ?? "";
    const opened = await openBuyToken(signed, started + 60_000);
    assert.equal(opened.ok, true);
    const event = checkoutEvent("cs_slow", "paid@example.com", {
      oauth_client_id: clientId,
      subject: "user_paid",
      flock,
      bind_nonce: link.nonce,
    });
    const seat = await applyStripeEvent(event);
    assert.ok(seat);
    const computers = await provisionSeatComputers(seat);
    assert.equal(await bindPurchasedComputer(event, seat, computers), true);
    await drive(token);
    const preview = await buyGet(new Request(link.url));
    assert.equal(preview.status, 400);
  });

  it("keeps an old capability token working and frames oauth and setup", async () => {
    process.env.NODE_ENV = "test";
    useBindKey();
    resetSeatStoreForTests();
    setOauthStoreForTests(new MemoryOauthStore());
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    setComputerServiceForTests(service);
    const flock = flockIdForEmail("old@example.com");
    const computer = await service.requestComputer({ birdId: "seat:old", flockId: flock });
    const issued = await service.issueBoundCapability(computer.id, flock);
    const { token } = await freshToken("old@example.com", "user_old");
    const exec = await callTool(token, "computer_exec", {
      capability_token: issued.token,
      computer_handle: computer.id,
      argv: ["uname", "-s"],
    });
    assert.equal(exec.isError, false);
    for (const path of ["/oauth/authorize", "/oauth/consent", "/setup"]) {
      const response = middleware({ nextUrl: { pathname: path } });
      assert.equal(response.headers.get("x-frame-options"), "DENY", path);
      assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/, path);
    }
  });

  it("rejects another account and disconnects only the chosen computer", async () => {
    process.env.NODE_ENV = "test";
    process.env.STAX_TEST_AUTH = "1";
    resetRateLimitsForTests();
    resetSeatStoreForTests();
    setOauthStoreForTests(new MemoryOauthStore());
    const service = new ComputerService(new FakeProvider(), { store: new MemoryControlPlaneStore() });
    setComputerServiceForTests(service);
    const owner = flockIdForEmail(EMAIL);
    const mine = await service.requestComputer({ birdId: "seat:mine", flockId: owner });
    const spare = await service.requestComputer({ birdId: "seat:spare", flockId: owner });
    await getSeatStore().upsert(
      createSeat({
        email: EMAIL,
        plan: "pro",
        stripeCustomerId: "cus_multi",
        computerId: mine.id,
        computerIds: [mine.id, spare.id],
        maxComputers: 2,
      }),
    );
    const holder = registerClient(["https://grok.com/callback"], "Holder");
    await getOauthStore().saveClient(holder);
    await getOauthStore().saveAccess({
      tokenHash: hashToken("holder-token"),
      refreshHash: hashToken("holder-refresh"),
      subject: "user_other_account",
      flock: owner,
      clientId: holder.id,
      email: EMAIL,
      computerId: mine.id,
      capabilityId: "cap_holder",
      expiresAt: Date.now() + 60_000,
      refreshExpiresAt: Date.now() + 60_000,
      revoked: false,
    });
    const client = registerClient(["https://grok.com/callback"], "Mine");
    await getOauthStore().saveClient(client);
    const redirect = client.redirectUris[0] ?? "";
    const held = await allowForm({
      clientId: client.id,
      redirect,
      challenge: pkceS256("verifier-value-which-is-long-enough"),
      email: EMAIL,
      subject: SUBJECT,
      ip: "203.0.113.50",
      computerId: mine.id,
    });
    assert.match(held.headers.get("location") ?? "", /\/oauth\/consent/);
    const foreign = await allowForm({
      clientId: client.id,
      redirect,
      challenge: pkceS256("verifier-value-which-is-long-enough"),
      email: EMAIL,
      subject: SUBJECT,
      ip: "203.0.113.51",
      computerId: "not-on-this-account",
    });
    assert.match(foreign.headers.get("location") ?? "", /\/oauth\/consent/);

    await getOauthStore().revokeComputerTokens(mine.id);
    const allowed = await allowForm({
      clientId: client.id,
      redirect,
      challenge: pkceS256("verifier-value-which-is-long-enough"),
      email: EMAIL,
      subject: SUBJECT,
      ip: "203.0.113.52",
      computerId: spare.id,
    });
    const code = new URL(allowed.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const exchanged = await exchangeCode({
      code,
      verifier: "verifier-value-which-is-long-enough",
      clientId: client.id,
      redirectUri: redirect,
    });
    assert.ok("token" in exchanged);
    if (!("token" in exchanged)) return;
    const cut = await disconnectPost(
      new Request(`${ORIGIN}/api/setup/disconnect`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/x-www-form-urlencoded",
          "x-stax-test-user": userHeader(SUBJECT, EMAIL),
        },
        body: new URLSearchParams({ computer_id: spare.id }),
      }),
    );
    assert.equal(cut.status, 200);
    const after = await callTool(exchanged.token, "computer_exec", { argv: ["uname", "-s"] });
    assert.equal(after.status === 401 || after.isError, true);

    const keptFlock = flockIdForEmail("kept@example.com");
    const kept = await service.requestComputer({ birdId: "seat:kept", flockId: keptFlock });
    const keptSeat = await getSeatStore().upsert(
      createSeat({
        email: "kept@example.com",
        plan: "personal",
        stripeCustomerId: "cus_kept",
        computerId: kept.id,
        computerIds: [kept.id],
      }),
    );
    const keptIssued = await service.issueBoundCapability(kept.id, keptFlock);
    const { token: keptToken, clientId: keptClient } = await freshToken("kept@example.com", "user_kept");
    await getOauthStore().bindLiveTokens({
      clientId: keptClient,
      subject: "user_kept",
      computerId: kept.id,
      capabilityId: keptIssued.capabilityId,
    });
    const canceledSeat = await getSeatStore().upsert(
      createSeat({
        email: EMAIL,
        plan: "personal",
        stripeCustomerId: "cus_cancel_only",
        computerId: spare.id,
        computerIds: [spare.id],
      }),
    );
    await shutdownSeatComputers({ ...canceledSeat, status: "canceled" }, "stop");
    const keptCall = await callTool(keptToken, "computer_exec", { argv: ["uname", "-s"] });
    assert.equal(keptCall.isError, false, JSON.stringify(keptCall.structuredContent));
    void keptSeat;
  });
});

async function drive(token: string): Promise<void> {
  const exec = await callTool(token, "computer_exec", { argv: ["uname", "-s"] });
  assert.equal(exec.isError, false, JSON.stringify(exec.structuredContent));
  const fs = await callTool(token, "computer_fs", { operation: "write", path: "note.txt", content: "ok" });
  assert.equal(fs.isError, false, JSON.stringify(fs.structuredContent));
  const observe = await callTool(token, "computer_observe", {});
  assert.equal(observe.isError, false, JSON.stringify(observe.structuredContent));
  const act = await callTool(token, "computer_act", { actions: [{ type: "wait", durationMs: 10 }] });
  assert.equal(act.isError, false, JSON.stringify(act.structuredContent));
}
