import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { POST as registerPost } from "../../web/app/oauth/register/route.ts";
import { POST as tokenPost } from "../../web/app/oauth/token/route.ts";
import { POST as mcpPost, toolNames } from "../../web/app/mcp/route.ts";
import { flockIdForEmail } from "../../web/lib/desks/runtime.ts";
import { bindPairFlock } from "../../web/lib/mcp-flock.ts";
import {
  MemoryOauthStore,
  accessClaims,
  exchangeCode,
  getOauthStore,
  issueCode,
  pkceS256,
  redirectHostAllowed,
  refreshAccess,
  registerClient,
  setOauthStoreForTests,
} from "../../web/lib/oauth.ts";
import { resetRateLimitsForTests } from "../../web/lib/rate-limit.ts";

const EMAIL = "ada@example.com";
const SUBJECT = "user_01JWORKOSSTYLEID";

describe("oauth and mcp", () => {
  it("pairs from the email flock, refreshes, and lists eight tools", async () => {
    resetRateLimitsForTests();
    const memory = new MemoryOauthStore();
    setOauthStoreForTests(memory);
    const client = registerClient(["https://grok.com/callback"]);
    await getOauthStore().saveClient(client);
    const verifier = "verifier-value-which-is-long-enough";
    const flock = flockIdForEmail(EMAIL);
    const code = await issueCode({
      clientId: client.id,
      redirectUri: client.redirectUris[0] ?? "",
      challenge: pkceS256(verifier),
      subject: SUBJECT,
      flock,
    });
    assert.notEqual(SUBJECT, flock);
    const wrong = await exchangeCode({
      code,
      verifier: "other-verifier-value-long",
      clientId: client.id,
      redirectUri: client.redirectUris[0] ?? "",
    });
    assert.deepEqual(wrong, { error: "invalid_grant" });
    const ok = await exchangeCode({
      code,
      verifier,
      clientId: client.id,
      redirectUri: client.redirectUris[0] ?? "",
    });
    assert.ok("token" in ok && "refresh" in ok);
    if (!("token" in ok)) return;
    const claims = await accessClaims(ok.token);
    assert.deepEqual(claims, { subject: SUBJECT, flock });
    const replay = await exchangeCode({
      code,
      verifier,
      clientId: client.id,
      redirectUri: client.redirectUris[0] ?? "",
    });
    assert.deepEqual(replay, { error: "invalid_grant" });

    const refreshed = await tokenPost(
      new Request("https://staxions-preview.vercel.app/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: ok.refresh }),
      }),
    );
    assert.equal(refreshed.status, 200);
    const next = (await refreshed.json()) as { access_token: string; refresh_token: string };
    assert.equal((await accessClaims(ok.token))?.subject, undefined);
    assert.equal((await accessClaims(next.access_token))?.flock, flock);

    const denied = await mcpPost(
      new Request("https://staxions-preview.vercel.app/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("www-authenticate") ?? "", /resource_metadata=/);

    const listed = await mcpPost(
      new Request("https://staxions-preview.vercel.app/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${next.access_token}`,
          "mcp-protocol-version": "2026-07-28",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    const raw = (await listed.json()) as { result?: { tools?: Array<{ name: string }> } };
    assert.deepEqual(
      raw.result?.tools?.map((tool) => tool.name),
      [...toolNames()],
    );
    assert.equal(toolNames().length, 8);

    const mismatched = await mcpPost(
      new Request("https://staxions-preview.vercel.app/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${next.access_token}`,
          "mcp-protocol-version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "computer_pair", arguments: { pair_code: "AAAA", bird_id: "bird", flock_id: "other-flock" } },
        }),
      }),
    );
    const mismatchBody = (await mismatched.json()) as { error?: { message?: string } };
    assert.match(mismatchBody.error?.message ?? "", /flock does not match/);
    const afterHour = await refreshAccess(next.refresh_token, Date.now() + 2 * 60 * 60_000);
    assert.ok("token" in afterHour);

    const batch = [
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "computer_pair", arguments: { pair_code: "AAAA", bird_id: "bird" } },
      },
    ];
    assert.equal(bindPairFlock(batch, flock), true);
    assert.equal(batch[0]?.params.arguments.flock_id, flock);
    const foreign = [
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "computer_pair", arguments: { flock_id: "not-the-email-flock" } },
      },
    ];
    assert.equal(bindPairFlock(foreign, flock), false);
  });

  it("allows only grok.com and x.ai https redirects", async () => {
    resetRateLimitsForTests();
    assert.equal(redirectHostAllowed("https://grok.com/cb"), true);
    assert.equal(redirectHostAllowed("https://app.x.ai/cb"), true);
    assert.equal(redirectHostAllowed("http://grok.com/cb"), false);
    assert.equal(redirectHostAllowed("https://evil.com/cb"), false);
    setOauthStoreForTests(new MemoryOauthStore());
    const rejected = await registerPost(
      new Request("https://staxions-preview.vercel.app/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["https://evil.example/cb"] }),
      }),
    );
    assert.equal(rejected.status, 400);
    const accepted = await registerPost(
      new Request("https://staxions-preview.vercel.app/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["https://grok.com/oauth/callback"] }),
      }),
    );
    assert.equal(accepted.status, 201);
  });
});
