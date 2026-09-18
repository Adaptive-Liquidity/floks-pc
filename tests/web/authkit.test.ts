import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authKitScreenHint, authStartFallbackPath } from "../../web/lib/auth/workos.ts";
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
