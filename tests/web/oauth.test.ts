import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GET as authorizeGet } from "../../web/app/oauth/authorize/route.ts";
import { POST as registerPost } from "../../web/app/oauth/register/route.ts";
import { POST as tokenPost } from "../../web/app/oauth/token/route.ts";
import { POST as mcpPost } from "../../web/app/mcp/route.ts";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp/tools.ts";
import { flockIdForEmail } from "../../web/lib/desks/runtime.ts";
import { bindPairFlock } from "../../web/lib/mcp-flock.ts";
import {
  MemoryOauthStore,
  accessClaims,
  exchangeCode,
  getOauthStore,
  issueCode,
  authorizationServerMetadata,
  pkceS256,
  redirectAllowed,
  redirectHostAllowed,
  refreshAccess,
  registerClient,
  setOauthStoreForTests,
} from "../../web/lib/oauth.ts";
import { resetRateLimitsForTests } from "../../web/lib/rate-limit.ts";

const EMAIL = "ada@example.com";
const SUBJECT = "user_01JWORKOSSTYLEID";

function registerRequest(body: string, ip: string): Request {
  return new Request("https://staxions-preview.vercel.app/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body,
  });
}

describe("oauth and mcp", { concurrency: 1 }, () => {
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
      [...MCP_TOOL_NAMES],
    );
    assert.equal(MCP_TOOL_NAMES.length, 8);

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

  it("keeps https redirects on grok.com and x.ai", async () => {
    resetRateLimitsForTests();
    assert.equal(redirectHostAllowed("https://grok.com/cb"), true);
    assert.equal(redirectHostAllowed("https://app.x.ai/cb"), true);
    assert.equal(redirectHostAllowed("http://grok.com/cb"), false);
    assert.equal(redirectHostAllowed("https://evil.com/cb"), false);
    setOauthStoreForTests(new MemoryOauthStore());
    const rejected = await registerPost(
      registerRequest(JSON.stringify({ redirect_uris: ["https://evil.example/cb"] }), "10.0.0.1"),
    );
    assert.equal(rejected.status, 400);
    const accepted = await registerPost(
      registerRequest(JSON.stringify({ redirect_uris: ["https://grok.com/oauth/callback"] }), "10.0.0.2"),
    );
    assert.equal(accepted.status, 201);
    const metadata = authorizationServerMetadata("https://staxions-preview.vercel.app");
    assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ["none"]);
  });

  it("registers Grok Bot's redirect list and loopback clients", async () => {
    resetRateLimitsForTests();
    setOauthStoreForTests(new MemoryOauthStore());
    const grok = await registerPost(
      registerRequest(
        JSON.stringify({
          redirect_uris: [
            "cursor://anysphere.cursor-mcp/oauth/callback",
            "https://www.cursor.com/agents/mcp/oauth/callback",
            "http://localhost:8787/callback",
          ],
        }),
        "10.1.0.1",
      ),
    );
    assert.equal(grok.status, 201);
    const created = (await grok.json()) as {
      client_id: string;
      client_id_issued_at: number;
      redirect_uris: string[];
      token_endpoint_auth_method: string;
      grant_types: string[];
      response_types: string[];
    };
    assert.deepEqual(created.redirect_uris, [
      "cursor://anysphere.cursor-mcp/oauth/callback",
      "https://www.cursor.com/agents/mcp/oauth/callback",
      "http://localhost:8787/callback",
    ]);
    assert.equal(typeof created.client_id, "string");
    assert.equal(created.token_endpoint_auth_method, "none");
    assert.deepEqual(created.grant_types, ["authorization_code", "refresh_token"]);
    assert.deepEqual(created.response_types, ["code"]);
    assert.ok(Math.abs(created.client_id_issued_at - Math.floor(Date.now() / 1000)) < 5);

    for (const [index, uri] of [
      "http://127.0.0.1:53682/callback",
      "http://localhost:8787/callback",
      "http://[::1]:9000/cb",
      "https://grok.com/oauth/callback",
    ].entries()) {
      const response = await registerPost(
        registerRequest(JSON.stringify({ redirect_uris: [uri] }), `10.1.0.${index + 2}`),
      );
      assert.equal(response.status, 201, uri);
      const body = (await response.json()) as { redirect_uris: string[] };
      assert.deepEqual(body.redirect_uris, [uri]);
    }
    const mixed = await registerPost(
      registerRequest(
        JSON.stringify({ redirect_uris: ["https://evil.example/cb", "https://grok.com/cb"] }),
        "10.1.0.9",
      ),
    );
    assert.equal(mixed.status, 201);
    const kept = (await mixed.json()) as { redirect_uris: string[] };
    assert.deepEqual(kept.redirect_uris, ["https://grok.com/cb"]);
  });

  it("rejects redirects outside the allow-list", async () => {
    const rejected = [
      "https://evil.example/cb",
      "https://www.cursor.com/evil",
      "https://grok.com.evil.example/cb",
      "http://localhost.evil.example/cb",
      "http://127.0.0.1.nip.io/cb",
      "http://user@127.0.0.1/cb",
      "javascript:alert(1)",
      "cursor://other/cb",
      "http://grok.com/cb",
      "http://127.0.0.1/cb#frag",
    ];
    for (const [index, uri] of rejected.entries()) {
      setOauthStoreForTests(new MemoryOauthStore());
      assert.equal(redirectHostAllowed(uri), false, uri);
      const response = await registerPost(
        registerRequest(JSON.stringify({ redirect_uris: [uri] }), `10.2.0.${index + 1}`),
      );
      assert.equal(response.status, 400, uri);
      const body = (await response.json()) as { error?: string };
      assert.equal(body.error, "invalid_client_metadata");
    }
  });

  it("returns 400 for malformed JSON and ignores unknown registration fields", async () => {
    resetRateLimitsForTests();
    setOauthStoreForTests(new MemoryOauthStore());
    const malformed = await registerPost(registerRequest("{", "10.3.0.1"));
    assert.equal(malformed.status, 400);
    const bad = (await malformed.json()) as { error?: string };
    assert.equal(bad.error, "invalid_client_metadata");
    const accepted = await registerPost(
      registerRequest(JSON.stringify({ redirect_uris: ["https://grok.com/cb"], client_name: "Grok" }), "10.3.0.2"),
    );
    assert.equal(accepted.status, 201);
  });

  it("lets a loopback client authorize on another port of the same host", async () => {
    resetRateLimitsForTests();
    setOauthStoreForTests(new MemoryOauthStore());
    const client = registerClient(["http://127.0.0.1/callback"]);
    await getOauthStore().saveClient(client);
    const ask = (redirectUri: string) =>
      authorizeGet(
        new Request(
          `https://staxions-preview.vercel.app/oauth/authorize?client_id=${client.id}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=abc&response_type=code`,
          { headers: { accept: "application/json" } },
        ),
      );
    const allowed = (await (await ask("http://127.0.0.1:61000/callback")).json()) as { status?: string };
    assert.equal(allowed.status, "signed_out");
    const otherPath = (await (await ask("http://127.0.0.1:61000/other")).json()) as { error?: string };
    assert.equal(otherPath.error, "invalid_client");
    const otherHost = (await (await ask("http://localhost:61000/callback")).json()) as { error?: string };
    assert.equal(otherHost.error, "invalid_client");
    assert.equal(redirectAllowed(client, "http://127.0.0.1:61000/callback"), true);
  });

  it("exchanges an authorization code for the localhost callback", async () => {
    resetRateLimitsForTests();
    setOauthStoreForTests(new MemoryOauthStore());
    const uri = "http://localhost:8787/callback";
    const registered = await registerPost(registerRequest(JSON.stringify({ redirect_uris: [uri] }), "10.4.0.1"));
    assert.equal(registered.status, 201);
    const created = (await registered.json()) as { client_id: string };
    const preflight = await authorizeGet(
      new Request(
        `https://staxions-preview.vercel.app/oauth/authorize?client_id=${created.client_id}&redirect_uri=${encodeURIComponent(uri)}&code_challenge=abc&response_type=code`,
        { headers: { accept: "application/json" } },
      ),
    );
    const ready = (await preflight.json()) as { status?: string; error?: string };
    assert.equal(ready.status, "signed_out");
    assert.equal(ready.error, undefined);
    const verifier = "verifier-value-which-is-long-enough";
    const code = await issueCode({
      clientId: created.client_id,
      redirectUri: uri,
      challenge: pkceS256(verifier),
      subject: SUBJECT,
      flock: flockIdForEmail(EMAIL),
    });
    const wrongPort = await tokenPost(
      new Request("https://staxions-preview.vercel.app/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          client_id: created.client_id,
          redirect_uri: "http://localhost:9999/callback",
        }),
      }),
    );
    assert.equal(wrongPort.status, 400);
    const token = await tokenPost(
      new Request("https://staxions-preview.vercel.app/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          client_id: created.client_id,
          redirect_uri: uri,
        }),
      }),
    );
    assert.equal(token.status, 200);
    const issued = (await token.json()) as { access_token?: string; token_type?: string };
    assert.equal(typeof issued.access_token, "string");
    assert.equal(issued.token_type, "Bearer");
  });

  it("returns a JSON-RPC envelope without a top-level _meta", async () => {
    resetRateLimitsForTests();
    const memory = new MemoryOauthStore();
    setOauthStoreForTests(memory);
    const client = registerClient(["https://grok.com/callback"]);
    await getOauthStore().saveClient(client);
    const verifier = "verifier-value-which-is-long-enough";
    const code = await issueCode({
      clientId: client.id,
      redirectUri: client.redirectUris[0] ?? "",
      challenge: pkceS256(verifier),
      subject: SUBJECT,
      flock: flockIdForEmail(EMAIL),
    });
    const issued = await exchangeCode({
      code,
      verifier,
      clientId: client.id,
      redirectUri: client.redirectUris[0] ?? "",
    });
    assert.ok("token" in issued);
    if (!("token" in issued)) return;
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${issued.token}`,
      "mcp-protocol-version": "2026-07-28",
    };
    const call = (body: string) =>
      mcpPost(
        new Request("https://staxions-preview.vercel.app/mcp", {
          method: "POST",
          headers,
          body,
        }),
      );
    const initialized = await call(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "grok", version: "0" },
        },
      }),
    );
    assert.equal(initialized.status, 200);
    const initBody = (await initialized.json()) as { result?: { tools?: unknown } };
    assert.deepEqual(Object.keys(initBody).sort(), ["id", "jsonrpc", "result"]);
    const listed = await call(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    );
    assert.equal(listed.status, 200);
    const listBody = (await listed.json()) as { result?: { tools?: Array<{ name: string }> } };
    assert.deepEqual(Object.keys(listBody).sort(), ["id", "jsonrpc", "result"]);
    assert.deepEqual(
      listBody.result?.tools?.map((tool) => tool.name),
      [...MCP_TOOL_NAMES],
    );
    assert.equal(listBody.result?.tools?.length, 8);
    const note = await call(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    assert.equal(note.status, 202);
    assert.equal(await note.text(), "");
    const malformed = await call("{");
    assert.equal(malformed.status, 400);
    const parseError = (await malformed.json()) as { error?: { code?: number } };
    assert.equal(parseError.error?.code, -32700);
  });
});
