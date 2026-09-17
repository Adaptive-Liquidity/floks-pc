import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gateFromSearch, parseSeatSession, previewSession } from "../../web/lib/session.ts";
import { previewEnabled } from "../../web/lib/preview.ts";
import { callbackFinishPlan } from "../../web/lib/setup-client.ts";
import { shouldSetSessionCookie } from "../../web/lib/auth/workos.ts";
import { emailsMatch, hoursForPlan, planFromAmount } from "../../web/lib/billing/plans.ts";

describe("setup gates + session parse", () => {
  it("classifies cold, just_paid, expired, invalid from the URL", () => {
    assert.deepEqual(gateFromSearch({}), { gate: "cold", sessionId: null });
    assert.deepEqual(gateFromSearch({ session_id: "cs_test" }), {
      gate: "just_paid",
      sessionId: "cs_test",
    });
    assert.deepEqual(gateFromSearch({ error: "expired" }), { gate: "expired", sessionId: null });
    assert.deepEqual(gateFromSearch({ link: "invalid" }), { gate: "invalid", sessionId: null });
  });

  it("parses a live seat JSON body and never requires a cookie field", () => {
    const session = parseSeatSession({
      billingEmail: "Owner@Example.com",
      plan: "shift",
      seats: 1,
      desk: { state: "pairing", user_code: "ABCD-EFGH", pending: true },
    });
    assert.ok(session);
    assert.equal(session.billingEmail, "Owner@Example.com");
    assert.equal(session.plan, "shift");
    assert.equal(session.desk?.state, "pairing");
    assert.equal(session.desk?.userCode, "ABCD-EFGH");
  });

  it("refuses to invent a sealed cookie from session_id or a user blob", () => {
    assert.equal(shouldSetSessionCookie(undefined), false);
    assert.equal(shouldSetSessionCookie(""), false);
    assert.equal(shouldSetSessionCookie("short"), false);
    assert.equal(shouldSetSessionCookie(JSON.stringify({ id: "user_1", email: "a@b.c" })), false);
    assert.equal(shouldSetSessionCookie("cs_test_not_a_sealed_session"), false);
    assert.equal(shouldSetSessionCookie("sealed-session-material-from-authkit-ok"), true);
  });

  it("keeps preview fixtures out of production", () => {
    assert.equal(previewEnabled(), process.env.FLOK_WEB_PREVIEW === "1" && process.env.NODE_ENV !== "production");
    assert.ok(previewSession("running"));
    assert.equal(previewSession("gallery"), null);
  });

  it("sends Stripe session_id to /setup and AuthKit code to /callback", () => {
    assert.equal(callbackFinishPlan(new URLSearchParams("session_id=cs_test")).shouldPost, false);
    assert.equal(
      callbackFinishPlan(new URLSearchParams("session_id=cs_test")).nextHref,
      "/setup?session_id=cs_test",
    );
    const authkit = callbackFinishPlan(new URLSearchParams("code=abc&session_id=cs_test"));
    assert.equal(authkit.shouldPost, false);
    assert.match(authkit.nextHref, /^\/callback\?/);
  });

  it("locks Spark/Desk/Shift hour caps and case-insensitive email bind", () => {
    assert.equal(hoursForPlan("spark"), 8);
    assert.equal(hoursForPlan("desk"), 25);
    assert.equal(hoursForPlan("shift"), 60);
    assert.equal(planFromAmount(1900), "spark");
    assert.equal(planFromAmount(12), null);
    assert.equal(emailsMatch("Caelin@Example.com", "caelin@example.com"), true);
    assert.equal(emailsMatch("a@b.c", "other@b.c"), false);
  });
});
