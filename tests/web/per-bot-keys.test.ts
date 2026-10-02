import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerService, FakeProvider } from "../../src/lib/computers/index.ts";
import { McpGateway } from "../../src/lib/mcp/handler.ts";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/tools.ts";
import { blobContainsSecret, RecordingLogger } from "../../src/lib/mcp/log.ts";
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
    await service.setClaimCheckoutNonce({ claimId: claim.claimId, flockId: flock, nonce });
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
});
