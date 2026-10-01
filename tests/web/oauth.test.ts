import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessSubject, exchangeCode, getOauthStore, issueCode, pkceS256, registerClient, setOauthStoreForTests, MemoryOauthStore } from "../../web/lib/oauth.ts";
import { POST as mcpPost, toolNames } from "../../web/app/mcp/route.ts";

describe("oauth and mcp", () => {
  it("rejects a wrong verifier, a reused code, and lists eight tools", async () => {
    const memory = new MemoryOauthStore();
    setOauthStoreForTests(memory);
    const client = registerClient(["https://grok.example/callback"]);
    await getOauthStore().saveClient(client);
    const verifier = "verifier-value-which-is-long-enough";
    const code = await issueCode({
      clientId: client.id,
      redirectUri: client.redirectUris[0] ?? "",
      challenge: pkceS256(verifier),
      subject: "owner:abc",
    });
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
    assert.ok("token" in ok);
    if ((await accessSubject(ok.token)) === null) throw new Error("token not visible to store");
    const replay = await exchangeCode({
      code,
      verifier,
      clientId: client.id,
      redirectUri: client.redirectUris[0] ?? "",
    });
    assert.deepEqual(replay, { error: "invalid_grant" });

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
          authorization: `Bearer ${"token" in ok ? ok.token : ""}`,
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
  });
});
