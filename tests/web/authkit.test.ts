import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GET, POST } from "../../web/app/callback/route.ts";
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
import { planCheckoutHref } from "../../web/lib/config.ts";
import { csrfOk } from "../../web/lib/auth/cookies.ts";

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
    assert.match(html, /name="referrer" content="same-origin"/);
    assert.doesNotMatch(html, /no-referrer/);
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

  it("sends unsigned plan clicks to /signup and signed-in clicks to server checkout", () => {
    assert.equal(planCheckoutHref("pro"), "/signup");
    assert.equal(planCheckoutHref("pro", { signedIn: false }), "/signup");
    assert.equal(planCheckoutHref("personal", { signedIn: true }), "/api/checkout?plan=personal");
    assert.equal(
      callbackFailurePath(Object.assign(new Error("bad"), { error: "invalid_client" })),
      "/setup?error=workos_env",
    );
    assert.equal(
      callbackFailurePath(new Error("invalid_client: client secret from a different environment")),
      "/setup?error=workos_env",
    );
    assert.equal(
      authKitErrorFields(new Error("invalid_client: client secret from a different environment")).error,
      "invalid_client",
    );
  });

  it("accepts a same-site callback with Origin null and rejects a cross-site POST", async () => {
    const origin = "https://staxions-preview.vercel.app";
    const sameSite = new Request(`${origin}/callback`, {
      method: "POST",
      headers: {
        origin: "null",
        "sec-fetch-site": "same-origin",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "code=test-code&state=",
    });
    assert.equal(csrfOk(sameSite, origin), true);
    const crossSite = new Request(`${origin}/callback`, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "code=test-code&state=",
    });
    assert.equal(csrfOk(crossSite, origin), false);

    const previous = {
      APP_URL: process.env.APP_URL,
      NEXT_PUBLIC_SITE_ORIGIN: process.env.NEXT_PUBLIC_SITE_ORIGIN,
      WORKOS_REDIRECT_URI: process.env.WORKOS_REDIRECT_URI,
      WORKOS_API_KEY: process.env.WORKOS_API_KEY,
      WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID,
      WORKOS_COOKIE_PASSWORD: process.env.WORKOS_COOKIE_PASSWORD,
    };
    process.env.APP_URL = origin;
    delete process.env.NEXT_PUBLIC_SITE_ORIGIN;
    delete process.env.WORKOS_REDIRECT_URI;
    delete process.env.WORKOS_API_KEY;
    delete process.env.WORKOS_CLIENT_ID;
    delete process.env.WORKOS_COOKIE_PASSWORD;
    try {
      const get = await GET(new Request(`${origin}/callback?code=test-code`));
      assert.equal(get.headers.get("referrer-policy"), "same-origin");

      const accepted = await POST(sameSite);
      const acceptedUrl = new URL(accepted.headers.get("location") ?? "", origin);
      assert.notEqual(`${acceptedUrl.pathname}${acceptedUrl.search}`, "/setup?error=invalid");

      const rejected = await POST(crossSite);
      const rejectedUrl = new URL(rejected.headers.get("location") ?? "", origin);
      assert.equal(`${rejectedUrl.pathname}${rejectedUrl.search}`, "/setup?error=invalid");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
