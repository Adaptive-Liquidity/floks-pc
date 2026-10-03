import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerService, FakeProvider } from "../../src/lib/computers/index.ts";
import { McpGateway } from "../../src/lib/mcp/handler.ts";
import { POST as disconnectPost } from "../../web/app/api/setup/disconnect/route.ts";
import { createSeat, getSeatStore, resetSeatStoreForTests } from "../../web/lib/billing/seats.ts";
import { flockIdForEmail, setComputerServiceForTests } from "../../web/lib/desks/runtime.ts";
import {
  MemoryOauthStore,
  accessClaims,
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
const EMAIL = "owner@example.com";

function userHeader(id: string, email: string): string {
  return JSON.stringify({ id, email });
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

describe("account login with per-bot keys", () => {
  it("refreshes a computer-bound account token after that computer is claimed", async () => {
    const previous = process.env.FLOK_PER_BOT_KEYS;
    const service = new ComputerService(new FakeProvider());
    setComputerServiceForTests(service);
    setOauthStoreForTests(new MemoryOauthStore());
    const flock = flockIdForEmail(EMAIL);
    const comp1 = await service.requestComputer({ birdId: "bird-account", flockId: flock });
    const issued = await service.issueBoundCapability(comp1.id, flock);
    const client = registerClient(["https://grok.com/callback"], "Grok");
    await getOauthStore().saveClient(client);
    const refresh = "rtk_account_bound";
    const otherRefresh = "rtk_other_client";
    const other = registerClient(["https://grok.com/callback"], "Other");
    await getOauthStore().saveClient(other);
    const now = Date.now();
    await getOauthStore().saveAccess({
      tokenHash: hashToken("atk_account_bound"),
      refreshHash: hashToken(refresh),
      subject: "user_owner",
      flock,
      clientId: client.id,
      email: EMAIL,
      computerId: comp1.id,
      capabilityId: issued.capabilityId,
      expiresAt: now + 60_000,
      refreshExpiresAt: now + 60_000,
      revoked: false,
    });
    await getOauthStore().saveAccess({
      tokenHash: hashToken("atk_other_client"),
      refreshHash: hashToken(otherRefresh),
      subject: "user_owner",
      flock,
      clientId: other.id,
      email: EMAIL,
      computerId: comp1.id,
      capabilityId: issued.capabilityId,
      expiresAt: now + 60_000,
      refreshExpiresAt: now + 60_000,
      revoked: false,
    });
    process.env.FLOK_PER_BOT_KEYS = "true";
    try {
      const claim = await service.createBotClaim({ flockId: flock, subject: "user_owner" });
      await service.approveBotClaim({
        claimId: claim.claimId,
        flockId: flock,
        computerId: comp1.id,
        botLabel: "Ada",
      });
      const redeemed = await service.redeemBotClaim({ code: claim.code, flockId: flock });
      assert.equal(redeemed.pending, false);
      const next = await refreshAccess(refresh, client.id);
      assert.ok("token" in next);
      if (!("token" in next)) return;
      const row = await getOauthStore().getAccess(hashToken(next.token));
      assert.equal(row?.computerId, null);
      assert.equal(row?.capabilityId, null);
      assert.equal(row?.revoked, false);
      const kept = await getOauthStore().getAccess(hashToken("atk_other_client"));
      assert.equal(kept?.revoked, false);
    } finally {
      if (previous === undefined) delete process.env.FLOK_PER_BOT_KEYS;
      else process.env.FLOK_PER_BOT_KEYS = previous;
    }
  });

  it("disconnect revokes the bot key and leaves the account token valid", async () => {
    const previous = process.env.FLOK_PER_BOT_KEYS;
    const previousAuth = process.env.STAX_TEST_AUTH;
    const previousNode = process.env.NODE_ENV;
    process.env.FLOK_PER_BOT_KEYS = "true";
    process.env.STAX_TEST_AUTH = "1";
    process.env.NODE_ENV = "test";
    resetRateLimitsForTests();
    resetSeatStoreForTests();
    const service = new ComputerService(new FakeProvider());
    const gateway = new McpGateway(service);
    setComputerServiceForTests(service);
    setOauthStoreForTests(new MemoryOauthStore());
    const flock = flockIdForEmail(EMAIL);
    const computer = await service.requestComputer({ birdId: "bird-cut", flockId: flock });
    await getSeatStore().upsert(
      createSeat({
        email: EMAIL,
        plan: "personal",
        stripeCustomerId: "cus_account",
        computerId: computer.id,
        computerIds: [computer.id],
      }),
    );
    const issued = await service.issueBoundCapability(computer.id, flock);
    const client = registerClient(["https://grok.com/callback"], "Grok");
    await getOauthStore().saveClient(client);
    const token = "atk_disconnect_account";
    const now = Date.now();
    await getOauthStore().saveAccess({
      tokenHash: hashToken(token),
      refreshHash: hashToken("rtk_disconnect_account"),
      subject: "user_owner",
      flock,
      clientId: client.id,
      email: EMAIL,
      computerId: computer.id,
      capabilityId: issued.capabilityId,
      expiresAt: now + 60_000,
      refreshExpiresAt: now + 60_000,
      revoked: false,
    });
    const claim = await service.createBotClaim({ flockId: flock, subject: "user_owner" });
    await service.approveBotClaim({
      claimId: claim.claimId,
      flockId: flock,
      computerId: computer.id,
      botLabel: "Ada",
    });
    const redeemed = await service.redeemBotClaim({ code: claim.code, flockId: flock });
    assert.equal(redeemed.pending, false);
    if (redeemed.pending) return;
    try {
      const cut = await disconnectPost(
        new Request(`${ORIGIN}/api/setup/disconnect`, {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "content-type": "application/x-www-form-urlencoded",
            "x-stax-test-user": userHeader("user_owner", EMAIL),
          },
          body: new URLSearchParams({ computer_id: computer.id }),
        }),
      );
      assert.equal(cut.status, 200);
      const claims = await accessClaims(token);
      assert.equal(claims?.subject, "user_owner");
      assert.equal((await getOauthStore().getAccess(hashToken(token)))?.revoked, false);
      const exec = await call(
        gateway,
        "computer_exec",
        { capability_token: redeemed.pair.token, argv: ["echo", "gone"] },
        { perBotKeys: true, account: { subject: "user_owner", flock, origin: ORIGIN } },
      );
      assert.equal(exec.body.code, "CAPABILITY_REVOKED");
    } finally {
      if (previous === undefined) delete process.env.FLOK_PER_BOT_KEYS;
      else process.env.FLOK_PER_BOT_KEYS = previous;
      if (previousAuth === undefined) delete process.env.STAX_TEST_AUTH;
      else process.env.STAX_TEST_AUTH = previousAuth;
      if (previousNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNode;
    }
  });

  it("exchanges a computer-scoped code as an account token when the flag is on", async () => {
    const previous = process.env.FLOK_PER_BOT_KEYS;
    process.env.FLOK_PER_BOT_KEYS = "true";
    const service = new ComputerService(new FakeProvider());
    setComputerServiceForTests(service);
    setOauthStoreForTests(new MemoryOauthStore());
    const flock = flockIdForEmail(EMAIL);
    const computer = await service.requestComputer({ birdId: "bird-exchange", flockId: flock });
    const client = registerClient(["https://grok.com/callback"], "Grok");
    await getOauthStore().saveClient(client);
    const verifier = "verifier-value-which-is-long-enough";
    const redirect = "https://grok.com/callback";
    try {
      const code = await issueCode({
        clientId: client.id,
        redirectUri: redirect,
        challenge: pkceS256(verifier),
        subject: "user_owner",
        flock,
        email: EMAIL,
        computerId: computer.id,
      });
      const exchanged = await exchangeCode({ code, verifier, clientId: client.id, redirectUri: redirect });
      assert.ok("token" in exchanged);
      if (!("token" in exchanged)) return;
      const row = await getOauthStore().getAccess(hashToken(exchanged.token));
      assert.equal(row?.computerId, null);
      assert.equal(row?.capabilityId, null);
    } finally {
      if (previous === undefined) delete process.env.FLOK_PER_BOT_KEYS;
      else process.env.FLOK_PER_BOT_KEYS = previous;
    }
  });

  it("keeps flag-off refresh and disconnect bound to the computer", async () => {
    delete process.env.FLOK_PER_BOT_KEYS;
    process.env.STAX_TEST_AUTH = "1";
    process.env.NODE_ENV = "test";
    resetRateLimitsForTests();
    resetSeatStoreForTests();
    const service = new ComputerService(new FakeProvider());
    setComputerServiceForTests(service);
    setOauthStoreForTests(new MemoryOauthStore());
    const flock = flockIdForEmail(EMAIL);
    const computer = await service.requestComputer({ birdId: "bird-flag-off", flockId: flock });
    await getSeatStore().upsert(
      createSeat({
        email: EMAIL,
        plan: "personal",
        stripeCustomerId: "cus_flag_off",
        computerId: computer.id,
        computerIds: [computer.id],
      }),
    );
    const issued = await service.issueBoundCapability(computer.id, flock);
    const client = registerClient(["https://grok.com/callback"], "Grok");
    await getOauthStore().saveClient(client);
    const refresh = "rtk_flag_off";
    const token = "atk_flag_off";
    const now = Date.now();
    await getOauthStore().saveAccess({
      tokenHash: hashToken(token),
      refreshHash: hashToken(refresh),
      subject: "user_owner",
      flock,
      clientId: client.id,
      email: EMAIL,
      computerId: computer.id,
      capabilityId: issued.capabilityId,
      expiresAt: now + 60_000,
      refreshExpiresAt: now + 60_000,
      revoked: false,
    });
    const next = await refreshAccess(refresh, client.id);
    assert.ok("token" in next);
    if (!("token" in next)) return;
    const row = await getOauthStore().getAccess(hashToken(next.token));
    assert.equal(row?.computerId, computer.id);
    assert.equal(row?.capabilityId, issued.capabilityId);
    const cut = await disconnectPost(
      new Request(`${ORIGIN}/api/setup/disconnect`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/x-www-form-urlencoded",
          "x-stax-test-user": userHeader("user_owner", EMAIL),
        },
        body: new URLSearchParams({ computer_id: computer.id }),
      }),
    );
    assert.equal(cut.status, 200);
    assert.equal(await accessClaims(next.token), null);
    delete process.env.STAX_TEST_AUTH;
  });
});
