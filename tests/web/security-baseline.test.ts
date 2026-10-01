import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { csrfOk } from "../../web/lib/auth/cookies.ts";
import { isProductionRuntime } from "../../web/lib/desks/runtime.ts";
import { resetRateLimitsForTests, takeRateLimit } from "../../web/lib/rate-limit.ts";
import { GET as health } from "../../web/app/api/health/route.ts";
import { GET as logoutGet } from "../../web/app/logout/route.ts";

describe("security baseline", () => {
  it("rejects a state change with no origin and no same-site fetch metadata", () => {
    const request = new Request("https://staxions-preview.vercel.app/api/setup/approve", { method: "POST" });
    assert.equal(csrfOk(request, "https://staxions-preview.vercel.app"), false);
  });

  it("still accepts Origin null when the fetch is same-origin", () => {
    const request = new Request("https://staxions-preview.vercel.app/callback", {
      method: "POST",
      headers: { origin: "null", "sec-fetch-site": "same-origin" },
    });
    assert.equal(csrfOk(request, "https://staxions-preview.vercel.app"), true);
  });

  it("returns 405 for GET /logout and 200 JSON for health", async () => {
    const logout = logoutGet();
    assert.equal(logout.status, 405);
    const body = await health().json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.sha, "string");
    assert.equal(typeof body.env, "string");
  });

  it("keys production refusal on NODE_ENV, not VERCEL_ENV", () => {
    assert.equal(isProductionRuntime({ NODE_ENV: "production" } as NodeJS.ProcessEnv), true);
    assert.equal(isProductionRuntime({ NODE_ENV: "development", VERCEL_ENV: "production" } as NodeJS.ProcessEnv), false);
  });

  it("returns a uniform limit after the window is full", () => {
    resetRateLimitsForTests();
    for (let i = 0; i < 8; i++) assert.equal(takeRateLimit("login:1.2.3.4", 8, 60_000, 1_000), true);
    assert.equal(takeRateLimit("login:1.2.3.4", 8, 60_000, 1_000), false);
  });
});
