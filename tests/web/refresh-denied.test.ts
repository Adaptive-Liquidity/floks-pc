import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputerService, FakeProvider } from "../../src/lib/computers/index.ts";
import { POST as tokenPost } from "../../web/app/oauth/token/route.ts";
import { setComputerServiceForTests } from "../../web/lib/desks/runtime.ts";
import {
  MemoryOauthStore,
  getOauthStore,
  hashToken,
  setOauthStoreForTests,
  type OauthAccess,
} from "../../web/lib/oauth.ts";
import { resetRateLimitsForTests } from "../../web/lib/rate-limit.ts";

const ORIGIN = "https://staxions-preview.vercel.app";

class LoseConsumeStore extends MemoryOauthStore {
  override async consumeRefresh(): Promise<OauthAccess | null> {
    return null;
  }
}

async function denied(refresh: string, clientId = "client-a"): Promise<{ status: number; body: unknown; line: string }> {
  const lines: string[] = [];
  const original = console.info;
  console.info = (msg?: unknown) => {
    lines.push(String(msg ?? ""));
  };
  try {
    const res = await tokenPost(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refresh,
          client_id: clientId,
        }),
      }),
    );
    return { status: res.status, body: await res.json(), line: lines.join("\n") };
  } finally {
    console.info = original;
  }
}

function save(refresh: string, patch: Partial<OauthAccess> = {}): Promise<void> {
  const now = Date.now();
  return getOauthStore().saveAccess({
    tokenHash: hashToken(`atk-${refresh}`),
    refreshHash: hashToken(refresh),
    subject: "user_a",
    flock: "flock-a",
    clientId: "client-a",
    email: "a@example.com",
    computerId: null,
    capabilityId: null,
    expiresAt: now + 60_000,
    refreshExpiresAt: now + 60_000,
    revoked: false,
    ...patch,
  });
}

describe("oauth refresh denials", () => {
  it("logs each reason and still returns invalid_grant", async () => {
    resetRateLimitsForTests();
    delete process.env.FLOK_PER_BOT_KEYS;
    setComputerServiceForTests(new ComputerService(new FakeProvider()));

    setOauthStoreForTests(new MemoryOauthStore());
    const missing = await denied("refresh-missing");
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.body, { error: "invalid_grant" });
    assert.match(missing.line, /"reason":"missing"/);

    setOauthStoreForTests(new MemoryOauthStore());
    await save("refresh-expired", { refreshExpiresAt: Date.now() - 1_000 });
    const expired = await denied("refresh-expired");
    assert.deepEqual(expired.body, { error: "invalid_grant" });
    assert.match(expired.line, /"reason":"expired"/);

    setOauthStoreForTests(new MemoryOauthStore());
    await save("refresh-client");
    const client = await denied("refresh-client", "other-client");
    assert.deepEqual(client.body, { error: "invalid_grant" });
    assert.match(client.line, /"reason":"client"/);

    setOauthStoreForTests(new LoseConsumeStore());
    await save("refresh-race");
    const raced = await denied("refresh-race");
    assert.deepEqual(raced.body, { error: "invalid_grant" });
    assert.match(raced.line, /"reason":"consumed_or_revoked"/);

    setOauthStoreForTests(new MemoryOauthStore());
    await save("refresh-extend", { computerId: "missing-computer", capabilityId: "missing-cap" });
    const extended = await denied("refresh-extend");
    assert.deepEqual(extended.body, { error: "invalid_grant" });
    assert.match(extended.line, /"reason":"extend_failed"/);
    for (const row of [missing, expired, client, raced, extended]) {
      assert.equal(row.line.split("oauth.refresh_denied").length - 1, 1);
    }
  });

  it("logs a reused refresh token as consumed_or_revoked", async () => {
    resetRateLimitsForTests();
    delete process.env.FLOK_PER_BOT_KEYS;
    setOauthStoreForTests(new MemoryOauthStore());
    await save("refresh-once");
    const first = await tokenPost(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: "refresh-once",
          client_id: "client-a",
        }),
      }),
    );
    assert.equal(first.status, 200);
    const again = await denied("refresh-once");
    assert.equal(again.status, 400);
    assert.deepEqual(again.body, { error: "invalid_grant" });
    assert.match(again.line, /"reason":"consumed_or_revoked"/);
    assert.equal(again.line.split("oauth.refresh_denied").length - 1, 1);
  });
});
