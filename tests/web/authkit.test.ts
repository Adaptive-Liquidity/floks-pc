import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authKitErrorFields,
  callbackAutoPostHtml,
  callbackDestination,
  callbackFailurePath,
  cookieSecureFromRequest,
  isAuthPrefetch,
  publicOriginFromRequest,
} from "../../web/lib/auth/callback.ts";
import { AuthNotConfigured, authKitScreenHint, authStartFallbackPath } from "../../web/lib/auth/workos.ts";
import { planCheckoutHref, stripePaymentHref, STRIPE_LINKS } from "../../web/lib/config.ts";

describe("AuthKit account-first helpers", () => {
  it("maps screen=sign-up to the AuthKit sign-up hint and everything else to sign-in", () => {
    assert.equal(authKitScreenHint("sign-up"), "sign-up");
    assert.equal(authKitScreenHint("sign-in"), "sign-in");
    assert.equal(authKitScreenHint(null), "sign-in");
    assert.equal(authKitScreenHint(undefined), "sign-in");
    assert.equal(authKitScreenHint("signup"), "sign-in");
  });

  it("falls back to /setup when WorkOS is missing, not an invalid-invitation error", () => {
    assert.equal(authStartFallbackPath(), "/setup");
  });

  it("builds the public origin from forwarded headers or WORKOS_REDIRECT_URI", () => {
    const previous = process.env.WORKOS_REDIRECT_URI;
    process.env.WORKOS_REDIRECT_URI = "https://floks-pc.vercel.app/callback";
    try {
      const request = new Request("http://127.0.0.1:3000/callback?code=secret", {
        headers: { "x-forwarded-host": "internal.example", "x-forwarded-proto": "http" },
      });
      assert.equal(publicOriginFromRequest(request), "https://floks-pc.vercel.app");
    } finally {
      if (previous === undefined) delete process.env.WORKOS_REDIRECT_URI;
      else process.env.WORKOS_REDIRECT_URI = previous;
    }
  });

  it("marks cookies Secure on Vercel and skips prefetch code exchange", () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      const request = new Request("http://127.0.0.1:3000/callback");
      assert.equal(cookieSecureFromRequest(request), true);
    } finally {
      if (previous === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous;
    }
    assert.equal(isAuthPrefetch(new Request("http://127.0.0.1/callback", { headers: { purpose: "prefetch" } })), true);
    assert.equal(isAuthPrefetch(new Request("http://127.0.0.1/callback")), false);
  });

  it("auto-POSTs the AuthKit code and never treats config errors as invalid invitation", () => {
    const html = callbackAutoPostHtml("abc&1", "checkout:cs_test", "https://floks-pc.vercel.app/callback");
    assert.match(html, /method="post"/);
    assert.match(html, /abc&amp;1/);
    assert.doesNotMatch(html, /abc&1"/);
    assert.equal(callbackDestination("checkout:cs_test"), "/setup?session_id=cs_test");
    assert.equal(callbackDestination(null), "/setup");
    assert.equal(callbackFailurePath(new AuthNotConfigured("WORKOS_COOKIE_PASSWORD is required")), "/setup");
    assert.equal(callbackFailurePath(Object.assign(new Error("bad"), { error: "invalid_grant" })), "/setup?error=expired");
    const fields = authKitErrorFields(new AuthNotConfigured("WORKOS_COOKIE_PASSWORD is required"));
    assert.equal(fields.name, "AuthNotConfigured");
    assert.doesNotMatch(JSON.stringify(fields), /password_[A-Za-z0-9]{8,}/);
  });

  it("sends unsigned plan clicks to /signup and signed-in clicks to Payment Links with email", () => {
    assert.equal(planCheckoutHref(STRIPE_LINKS.desk), "/signup");
    assert.equal(planCheckoutHref(STRIPE_LINKS.desk, { signedIn: false }), "/signup");
    const paid = planCheckoutHref(STRIPE_LINKS.spark, {
      signedIn: true,
      email: "Owner@Example.com",
    });
    assert.match(paid, /^https:\/\/buy\.stripe\.com\//);
    assert.match(paid, /prefilled_email=Owner%40Example\.com/);
    assert.equal(stripePaymentHref(STRIPE_LINKS.shift, null), STRIPE_LINKS.shift);
  });
});
