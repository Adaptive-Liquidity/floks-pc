import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerService, FakeProvider, MemoryControlPlaneStore } from "../../src/lib/computers/index.ts";
import { McpGateway } from "../../src/lib/mcp/handler.ts";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/tools.ts";
import { blobContainsSecret, RecordingLogger } from "../../src/lib/mcp/log.ts";
import { POST as claimBuyPost } from "../../web/app/api/bots/claims/[claimId]/buy/route.ts";
import { bindPurchasedComputer } from "../../web/lib/billing/bind-purchase.ts";
import { MemoryPendingBindStore, setPendingBindStoreForTests } from "../../web/lib/billing/pending-binds.ts";
import { createSeat, resetSeatStoreForTests } from "../../web/lib/billing/seats.ts";
import { flockIdForEmail, setComputerServiceForTests } from "../../web/lib/desks/runtime.ts";
import { POST as mcpPost } from "../../web/app/mcp/route.ts";
import {
  MemoryOauthStore,
  exchangeCode,
  getOauthStore,
  issueCode,
  pkceS256,
  registerClient,
  setOauthStoreForTests,
} from "../../web/lib/oauth.ts";

const ORIGIN = "https://staxions-preview.vercel.app";
const MESSAGE =
  "Ask your human to open approve_url, name this bot and pick its computer. Then call computer_pair again with this pair_code. Keep pair_code and your capability_token private in your own bot memory, never in shared files or account-wide secrets.";

function ctx(flock: string) {
  return {
    perBotKeys: true as const,
    account: { subject: "user_a", flock, origin: ORIGIN },
  };
}

async function call(
  gateway: McpGateway,
  name: string,
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
): Promise<{ isError: boolean; body: Record<string, unknown> }> {
  const res = await gateway.handleJsonRpc(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    extra,
  );
  assert.ok(res && !Array.isArray(res));
  const result = (res as { result: { isError?: boolean; structuredContent?: Record<string, unknown> } }).result;
  return { isError: result.isError === true, body: result.structuredContent ?? {} };
}

describe("per-bot computer keys", () => {
  it("gives two bots two computers and refuses a missing or crossed key", async () => {
    const service = new ComputerService(new FakeProvider());
    const gateway = new McpGateway(service);
    const flock = "flock-bots";
    const comp1 = await service.requestComputer({ birdId: "bird-1", flockId: flock });
    const comp2 = await service.requestComputer({ birdId: "bird-2", flockId: flock });
    const account = ctx(flock);
    const first = await call(gateway, "computer_pair", {}, account);
    assert.equal(first.body.needs_approval, true);
    assert.equal(first.body.message, MESSAGE);
    const codeA = String(first.body.pair_code);
    const claimA = String(first.body.approve_url).split("/").pop() ?? "";
    await service.approveBotClaim({ claimId: claimA, flockId: flock, computerId: comp1.id, botLabel: "Ada" });
    const keyA = await call(gateway, "computer_pair", { pair_code: codeA }, account);
    assert.equal(keyA.body.connected, true);
    assert.equal(keyA.body.bot_label, "Ada");
    const tokenA = String(keyA.body.capability_token);

    const second = await call(gateway, "computer_pair", {}, account);
    const codeB = String(second.body.pair_code);
    const claimB = String(second.body.approve_url).split("/").pop() ?? "";
    await service.approveBotClaim({ claimId: claimB, flockId: flock, computerId: comp2.id, botLabel: "Bea" });
    const keyB = await call(gateway, "computer_pair", { pair_code: codeB }, account);
    const tokenB = String(keyB.body.capability_token);

    const own = await call(gateway, "computer_exec", { capability_token: tokenA, argv: ["echo", "a"] }, account);
    assert.equal(own.isError, false);
    assert.equal(own.body.bot_label, "Ada");
    const crossed = await call(
      gateway,
      "computer_exec",
      { capability_token: tokenA, computer_handle: comp2.id, argv: ["echo", "no"] },
      account,
    );
    assert.equal(crossed.isError, true);
    assert.equal(crossed.body.code, "CAPABILITY_INVALID");
    const missing = await call(gateway, "computer_status", {}, account);
    assert.equal(missing.body.code, "BOT_KEY_REQUIRED");
    const accountOnly = await call(gateway, "computer_status", {}, { perBotKeys: true, account: account.account });
    assert.equal(accountOnly.body.code, "BOT_KEY_REQUIRED");
    const bea = await call(gateway, "computer_exec", { capability_token: tokenB, argv: ["echo", "b"] }, account);
    assert.equal(bea.isError, false);
    assert.equal(bea.body.bot_label, "Bea");
    assert.notEqual(keyA.body.computer_handle, keyB.body.computer_handle);
  });

  it("rejects another flock, a reused code, an expired code, and a sixth guess", async () => {
    let now = Date.parse("2026-10-02T00:00:00.000Z");
    const service = new ComputerService(new FakeProvider(), { now: () => now });
    const flock = "flock-lock";
    const computer = await service.requestComputer({ birdId: "bird-lock", flockId: flock });
    const created = await service.createBotClaim({ flockId: flock, subject: "user_a" });
    await assert.rejects(() =>
      service.approveBotClaim({
        claimId: created.claimId,
        flockId: "other-flock",
        computerId: computer.id,
        botLabel: "Nope",
      }),
    );
    await service.approveBotClaim({
      claimId: created.claimId,
      flockId: flock,
      computerId: computer.id,
      botLabel: "Ada",
    });
    const once = await service.redeemBotClaim({ code: created.code, flockId: flock });
    assert.equal(once.pending, false);
    await assert.rejects(() => service.redeemBotClaim({ code: created.code, flockId: flock }));

    const expiring = await service.createBotClaim({ flockId: flock, subject: "user_a" });
    now += 16 * 60 * 1000;
    await assert.rejects(() => service.redeemBotClaim({ code: expiring.code, flockId: flock }));

    now = Date.parse("2026-10-02T01:00:00.000Z");
    const locked = await service.createBotClaim({ flockId: flock, subject: "user_a" });
    await service.approveBotClaim({
      claimId: locked.claimId,
      flockId: flock,
      computerId: computer.id,
      botLabel: "Ada",
    });
    for (let i = 0; i < 5; i += 1) {
      await assert.rejects(() => service.redeemBotClaim({ code: locked.code, flockId: "wrong-flock" }));
    }
    await assert.rejects(() => service.redeemBotClaim({ code: locked.code, flockId: flock }));
  });

  it("revokes the previous bot when the computer is claimed again", async () => {
    const service = new ComputerService(new FakeProvider());
    const gateway = new McpGateway(service);
    const flock = "flock-take";
    const computer = await service.requestComputer({ birdId: "bird-take", flockId: flock });
    const account = ctx(flock);
    const first = await service.createBotClaim({ flockId: flock, subject: "user_a" });
    await service.approveBotClaim({ claimId: first.claimId, flockId: flock, computerId: computer.id, botLabel: "Ada" });
    const keyA = await service.redeemBotClaim({ code: first.code, flockId: flock });
    assert.equal(keyA.pending, false);
    if (keyA.pending) return;
    const second = await service.createBotClaim({ flockId: flock, subject: "user_a" });
    await service.approveBotClaim({
      claimId: second.claimId,
      flockId: flock,
      computerId: computer.id,
      botLabel: "Bea",
    });
    await service.redeemBotClaim({ code: second.code, flockId: flock });
    const denied = await call(
      gateway,
      "computer_exec",
      { capability_token: keyA.pair.token, argv: ["echo", "old"] },
      account,
    );
    assert.equal(denied.body.code, "CAPABILITY_REVOKED");
  });

  it("attaches a purchase only to the claim and not to a computer that already has a key", async () => {
    process.env.FLOK_PER_BOT_KEYS = "true";
    const service = new ComputerService(new FakeProvider());
    setComputerServiceForTests(service);
    setPendingBindStoreForTests(new MemoryPendingBindStore());
    resetSeatStoreForTests();
    const email = "buyer@example.com";
    const flock = flockIdForEmail(email);
    const taken = await service.requestComputer({ birdId: "bird-taken", flockId: flock });
    const fresh = await service.requestComputer({ birdId: "bird-fresh", flockId: flock });
    const existing = await service.createBotClaim({ flockId: flock, subject: "user_buyer" });
    await service.approveBotClaim({
      claimId: existing.claimId,
      flockId: flock,
      computerId: taken.id,
      botLabel: "Ada",
    });
    await service.redeemBotClaim({ code: existing.code, flockId: flock });
    const claim = await service.createBotClaim({ flockId: flock, subject: "user_buyer" });
    const nonce = "nonce-claim-only";
    await service.setClaimCheckoutNonce({ claimId: claim.claimId, flockId: flock, nonce, botLabel: "Bea" });
    await (await import("../../web/lib/billing/pending-binds.ts")).getPendingBindStore().save({
      nonce,
      clientId: "client",
      subject: "user_buyer",
      flock,
      plan: "personal",
      email,
      expiresAt: Date.now() + 60_000,
      openedAt: null,
      usedAt: null,
    });
    const seat = createSeat({
      email,
      plan: "personal",
      stripeCustomerId: "cus_bot",
      computerId: taken.id,
      computerIds: [taken.id, fresh.id],
    });
    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: {
            bind_nonce: nonce,
            subject: "user_buyer",
            flock,
            oauth_client_id: "client",
          },
        },
      },
    } as unknown as import("stripe").Stripe.Event;
    const ok = await bindPurchasedComputer(event, seat, [
      { ...taken },
      { ...fresh },
    ]);
    assert.equal(ok, true);
    const stored = await service.getBotClaim(claim.claimId);
    assert.equal(stored?.computerId, fresh.id);
    delete process.env.FLOK_PER_BOT_KEYS;
  });

  it("lists exactly eight tools and does not log a pair code", async () => {
    const service = new ComputerService(new FakeProvider());
    const logger = new RecordingLogger();
    const gateway = new McpGateway(service, { logger });
    const listed = await gateway.handleJsonRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {});
    const tools = ((listed as { result: { tools: Array<{ name: string }> } }).result.tools).map((tool) => tool.name);
    assert.deepEqual(tools, [...MCP_TOOL_NAMES]);
    setOauthStoreForTests(new MemoryOauthStore());
    setComputerServiceForTests(service);
    process.env.FLOK_PER_BOT_KEYS = "true";
    process.env.STAX_TEST_AUTH = "1";
    const client = registerClient([`${ORIGIN}/callback`]);
    await getOauthStore().saveClient(client);
    const verifier = "verifier-value-which-is-long-enough";
    const code = await issueCode({
      clientId: client.id,
      redirectUri: `${ORIGIN}/callback`,
      challenge: pkceS256(verifier),
      subject: "user_log",
      flock: "flock-log",
      email: "log@example.com",
    });
    const exchanged = await exchangeCode({
      code,
      verifier,
      clientId: client.id,
      redirectUri: `${ORIGIN}/callback`,
    });
    assert.ok("token" in exchanged);
    if (!("token" in exchanged)) return;
    const lines: string[] = [];
    const original = console.info;
    console.info = (msg?: unknown) => {
      lines.push(String(msg ?? ""));
    };
    try {
      const res = await mcpPost(
        new Request(`${ORIGIN}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${exchanged.token}`,
            "user-agent": "GrokBot/1",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "computer_pair",
              arguments: {},
              _meta: { "io.modelcontextprotocol/clientInfo": { name: "grok", version: "1" } },
            },
          }),
        }),
      );
      const json = (await res.json()) as { result?: { structuredContent?: { pair_code?: string } } };
      const pairCode = json.result?.structuredContent?.pair_code ?? "";
      assert.equal(blobContainsSecret(lines.join("\n"), pairCode), false);
      assert.match(lines.join("\n"), /mcp.request_shape/);
      assert.equal(logger.blob().includes(pairCode), false);
    } finally {
      console.info = original;
      delete process.env.FLOK_PER_BOT_KEYS;
      delete process.env.STAX_TEST_AUTH;
    }
  });

  it("keeps a checkout claim redeemable after the short claim window", async () => {
    const previous = process.env.FLOK_PER_BOT_KEYS;
    process.env.FLOK_PER_BOT_KEYS = "true";
    let now = Date.parse("2026-10-02T00:00:00.000Z");
    const service = new ComputerService(new FakeProvider(), { now: () => now });
    const gateway = new McpGateway(service);
    setComputerServiceForTests(service);
    setPendingBindStoreForTests(new MemoryPendingBindStore());
    resetSeatStoreForTests();
    const email = "checkout@example.com";
    const flock = flockIdForEmail(email);
    const account = ctx(flock);
    const claim = await service.createBotClaim({ flockId: flock, subject: "user_buyer" });
    const nonce = "nonce-checkout-open";
    await service.setClaimCheckoutNonce({
      claimId: claim.claimId,
      flockId: flock,
      nonce,
      botLabel: "Ada",
    });
    now += 20 * 60 * 1000;
    await service.requestComputer({ birdId: "bird-unrelated", flockId: "other-flock" });
    assert.equal((await service.getBotClaim(claim.claimId))?.botLabel, "Ada");
    const waiting = await call(gateway, "computer_pair", { pair_code: claim.code }, account);
    assert.equal(waiting.body.connected, false);
    assert.equal(waiting.body.pending, true);
    assert.equal(waiting.body.message, "Waiting for checkout to finish.");
    const fresh = await service.requestComputer({ birdId: "bird-bought", flockId: flock });
    await (await import("../../web/lib/billing/pending-binds.ts")).getPendingBindStore().save({
      nonce,
      clientId: "client",
      subject: "user_buyer",
      flock,
      plan: "personal",
      email,
      expiresAt: Date.now() + 60_000,
      openedAt: null,
      usedAt: null,
    });
    const seat = createSeat({
      email,
      plan: "personal",
      stripeCustomerId: "cus_checkout",
      computerId: fresh.id,
      computerIds: [fresh.id],
    });
    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: {
            bind_nonce: nonce,
            subject: "user_buyer",
            flock,
            oauth_client_id: "client",
          },
        },
      },
    } as unknown as import("stripe").Stripe.Event;
    const ok = await bindPurchasedComputer(event, seat, [{ ...fresh }]);
    assert.equal(ok, true);
    const stored = await service.getBotClaim(claim.claimId);
    assert.equal(stored?.status, "approved");
    assert.equal(stored?.computerId, fresh.id);
    const paired = await call(gateway, "computer_pair", { pair_code: claim.code }, account);
    assert.equal(paired.body.connected, true);
    assert.equal(paired.body.bot_label, "Ada");
    const exec = await call(
      gateway,
      "computer_exec",
      { capability_token: paired.body.capability_token, argv: ["echo", "bought"] },
      account,
    );
    assert.equal(exec.isError, false);
    assert.equal(exec.body.bot_label, "Ada");
    if (previous === undefined) delete process.env.FLOK_PER_BOT_KEYS;
    else process.env.FLOK_PER_BOT_KEYS = previous;
  });

  it("does not open checkout when the claim is for another flock", async () => {
    const previousNode = process.env.NODE_ENV;
    const previousAuth = process.env.STAX_TEST_AUTH;
    process.env.NODE_ENV = "test";
    process.env.STAX_TEST_AUTH = "1";
    const service = new ComputerService(new FakeProvider());
    setComputerServiceForTests(service);
    const claim = await service.createBotClaim({ flockId: "other-flock", subject: "user_other" });
    const res = await claimBuyPost(
      new Request(`${ORIGIN}/api/bots/claims/${claim.claimId}/buy`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/x-www-form-urlencoded",
          "x-stax-test-user": JSON.stringify({ id: "user_buyer", email: "buyer@example.com" }),
        },
        body: new URLSearchParams({ bot_name: "Ada", plan: "personal" }),
      }),
      { params: Promise.resolve({ claimId: claim.claimId }) },
    );
    assert.equal(res.status, 404);
    if (previousNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNode;
    if (previousAuth === undefined) delete process.env.STAX_TEST_AUTH;
    else process.env.STAX_TEST_AUTH = previousAuth;
  });

  it("reports an existing key without creating a claim", async () => {
    const store = new MemoryControlPlaneStore();
    const service = new ComputerService(new FakeProvider(), { store });
    const gateway = new McpGateway(service);
    const flock = "flock-check";
    const computer = await service.requestComputer({ birdId: "bird-check", flockId: flock });
    const created = await service.createBotClaim({ flockId: flock, subject: "user_a" });
    await service.approveBotClaim({
      claimId: created.claimId,
      flockId: flock,
      computerId: computer.id,
      botLabel: "Ada",
    });
    const key = await service.redeemBotClaim({ code: created.code, flockId: flock });
    assert.equal(key.pending, false);
    if (key.pending) return;
    const before = (await store.load())?.botClaims.length ?? 0;
    const checked = await call(
      gateway,
      "computer_pair",
      { capability_token: key.pair.token, computer_handle: computer.id },
      ctx(flock),
    );
    assert.equal(checked.isError, false);
    assert.equal(checked.body.connected, true);
    assert.equal(checked.body.computer_handle, computer.id);
    assert.equal(checked.body.bot_label, "Ada");
    assert.equal(checked.body.state, "running");
    assert.equal((await store.load())?.botClaims.length ?? 0, before);
  });

  it("throttles a connection after repeated bad pair codes", async () => {
    const service = new ComputerService(new FakeProvider());
    const gateway = new McpGateway(service);
    const account = { ...ctx("flock-throttle"), authorization: "Bearer oauth:flock-throttle" };
    for (let i = 0; i < 20; i += 1) {
      const denied = await call(gateway, "computer_pair", { pair_code: "NOPE" }, account);
      assert.equal(denied.body.code, "PAIR_CODE_INVALID");
    }
    const blocked = await call(gateway, "computer_pair", { pair_code: "NOPE" }, account);
    assert.equal(blocked.body.code, "PAIR_THROTTLED");
  });

  it("logs request shape on preview and stays quiet in production", async () => {
    const previousNode = process.env.NODE_ENV;
    const previousVercel = process.env.VERCEL_ENV;
    const previousFlag = process.env.FLOK_PER_BOT_KEYS;
    const previousAuth = process.env.STAX_TEST_AUTH;
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";
    process.env.FLOK_PER_BOT_KEYS = "true";
    process.env.STAX_TEST_AUTH = "1";
    setOauthStoreForTests(new MemoryOauthStore());
    setComputerServiceForTests(new ComputerService(new FakeProvider()));
    const client = registerClient([`${ORIGIN}/callback`]);
    await getOauthStore().saveClient(client);
    const verifier = "verifier-value-which-is-long-enough";
    const code = await issueCode({
      clientId: client.id,
      redirectUri: `${ORIGIN}/callback`,
      challenge: pkceS256(verifier),
      subject: "user_shape",
      flock: "flock-shape",
      email: "shape@example.com",
    });
    const exchanged = await exchangeCode({
      code,
      verifier,
      clientId: client.id,
      redirectUri: `${ORIGIN}/callback`,
    });
    assert.ok("token" in exchanged);
    if (!("token" in exchanged)) return;
    const lines: string[] = [];
    const original = console.info;
    console.info = (msg?: unknown) => {
      lines.push(String(msg ?? ""));
    };
    const post = () =>
      mcpPost(
        new Request(`${ORIGIN}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${exchanged.token}`,
            "user-agent": "GrokBot/1",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );
    try {
      await post();
      const preview = lines.join("\n");
      assert.match(preview, /mcp.request_shape/);
      assert.equal(blobContainsSecret(preview, exchanged.token), false);
      lines.length = 0;
      process.env.VERCEL_ENV = "production";
      await post();
      assert.equal(lines.join("\n").includes("mcp.request_shape"), false);
    } finally {
      console.info = original;
      if (previousNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNode;
      if (previousVercel === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previousVercel;
      if (previousFlag === undefined) delete process.env.FLOK_PER_BOT_KEYS;
      else process.env.FLOK_PER_BOT_KEYS = previousFlag;
      if (previousAuth === undefined) delete process.env.STAX_TEST_AUTH;
      else process.env.STAX_TEST_AUTH = previousAuth;
    }
  });
});
