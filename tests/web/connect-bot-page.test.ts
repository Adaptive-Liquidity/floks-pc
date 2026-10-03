import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ComputerService, FakeProvider } from "../../src/lib/computers/index.ts";
import { POST as claimBuyPost } from "../../web/app/api/bots/claims/[claimId]/buy/route.ts";
import { MemoryPendingBindStore, setPendingBindStoreForTests } from "../../web/lib/billing/pending-binds.ts";
import { flockIdForEmail, setComputerServiceForTests } from "../../web/lib/desks/runtime.ts";
import { resetRateLimitsForTests } from "../../web/lib/rate-limit.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PAGE = readFileSync(join(ROOT, "web/app/connect-bot/[claimId]/page.tsx"), "utf8");
const ORIGIN = "https://staxions-preview.vercel.app";
const EMAIL = "buyer@example.com";

function useBindKey(): void {
  process.env.STAXIONS_BIND_SECRET = ["test-bind-", "0123456789-abcdef-0123456789"].join("");
}

describe("connect-bot page", () => {
  it("has one visible bot name shared by approve and buy", () => {
    assert.equal(PAGE.split('name="bot_name"').length - 1, 1);
    assert.match(PAGE, /htmlFor="bot-name"/);
    assert.match(PAGE, /id="bot-name"/);
    assert.match(PAGE, /id="bot-name"[\s\S]*className="code"/);
    assert.equal(PAGE.split("Bot name").length - 1, 1);
    assert.match(PAGE, /formAction=\{`\/api\/bots\/claims\/\$\{claimId\}\/buy`\}/);
    assert.match(PAGE, /formNoValidate/);
  });

  it("sends an empty name back to the page and a real name to checkout", async () => {
    process.env.NODE_ENV = "test";
    process.env.STAX_TEST_AUTH = "1";
    useBindKey();
    resetRateLimitsForTests();
    setPendingBindStoreForTests(new MemoryPendingBindStore());
    const service = new ComputerService(new FakeProvider());
    setComputerServiceForTests(service);
    const flock = flockIdForEmail(EMAIL);
    const claim = await service.createBotClaim({ flockId: flock, subject: "user_buyer" });
    const empty = await claimBuyPost(
      new Request(`${ORIGIN}/api/bots/claims/${claim.claimId}/buy`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/x-www-form-urlencoded",
          "x-stax-test-user": JSON.stringify({ id: "user_buyer", email: EMAIL }),
        },
        body: new URLSearchParams({ bot_name: "  ", plan: "personal" }),
      }),
      { params: Promise.resolve({ claimId: claim.claimId }) },
    );
    assert.equal(empty.status, 303);
    assert.equal(empty.headers.get("location"), `${ORIGIN}/connect-bot/${claim.claimId}?error=bot_name`);

    const named = await claimBuyPost(
      new Request(`${ORIGIN}/api/bots/claims/${claim.claimId}/buy`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/x-www-form-urlencoded",
          "x-stax-test-user": JSON.stringify({ id: "user_buyer", email: EMAIL }),
        },
        body: new URLSearchParams({ bot_name: "Ada", plan: "personal" }),
      }),
      { params: Promise.resolve({ claimId: claim.claimId }) },
    );
    assert.equal(named.status, 303);
    const location = named.headers.get("location") ?? "";
    assert.match(location, new RegExp(`^${ORIGIN}/buy\\?t=`));
    const stored = await service.getBotClaim(claim.claimId);
    assert.equal(stored?.botLabel, "Ada");
    assert.ok(stored?.checkoutNonce);
    delete process.env.STAX_TEST_AUTH;
  });
});
