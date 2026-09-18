import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { oauthUiFromPreflight, parseAuthorizePreflightBody } from "../../web/lib/oauth.ts";
import { callbackFinishPlan } from "../../web/lib/setup-client.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = join(ROOT, "web");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

function read(rel: string): string {
  return readFileSync(join(WEB, rel), "utf8");
}

function surface(): string {
  return walk(join(WEB, "app"))
    .concat(walk(join(WEB, "components")))
    .concat([join(WEB, "lib/copy.ts"), join(WEB, "lib/legal.ts")])
    .filter((path) => path.endsWith(".tsx") || path.endsWith(".ts") || path.endsWith(".css"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

describe("public site lock", () => {
  it("ships routed app files, not one HTML file", () => {
    const pages = [
      "app/page.tsx",
      "app/join/page.tsx",
      "app/product/page.tsx",
      "app/how/page.tsx",
      "app/now/page.tsx",
      "app/faq/page.tsx",
      "app/setup/page.tsx",
      "app/login/route.ts",
      "app/callback/route.ts",
      "app/logout/route.ts",
      "app/oauth/authorize/page.tsx",
      "app/legal/page.tsx",
      "app/legal/terms/page.tsx",
      "app/legal/privacy/page.tsx",
      "app/legal/aup/page.tsx",
      "app/legal/refund/page.tsx",
      "app/legal/cancellation/page.tsx",
      "app/legal/retention/page.tsx",
      "app/legal/support/page.tsx",
      "app/not-found.tsx",
      "app/error.tsx",
      "app/layout.tsx",
      "app/globals.css",
    ];
    for (const page of pages) {
      assert.equal(existsSync(join(WEB, page)), true, page);
    }
    assert.equal(existsSync(join(WEB, "index.html")), false);
    assert.equal(existsSync(join(WEB, "app/callback/page.tsx")), false);
  });

  it("does not ship forbidden public routes", () => {
    const forbidden = [
      "signup",
      "register",
      "account",
      "billing",
      "computers",
      "pair",
      "docs",
      "help",
      "pricing",
      "buy",
      "spark",
      "desk",
      "shift",
      "architecture",
      "systems",
      "research",
      "evidence",
      "company",
      "asentxia",
      "waitlist",
      "access",
      "apply",
      "dca",
    ];
    for (const name of forbidden) {
      assert.equal(existsSync(join(WEB, "app", name)), false, name);
    }
  });

  it("keeps locked claim-safe copy and kills mock lines", () => {
    const copy = read("lib/copy.ts");
    assert.match(copy, /The Agent Computer/);
    assert.match(copy, /Your agent has a mind\./);
    assert.match(copy, /isolated Agent Computer/);
    assert.match(copy, /Work stays in Grok/);
    assert.match(copy, /Spark — \$19\/mo — 8 hours — 1 computer/);
    assert.match(copy, /Desk — \$39\/mo — 25 hours — 1 computer/);
    assert.match(copy, /Shift — \$69\/mo — 60 hours — 1 computer/);
    assert.match(copy, /Same eight tools on every desk\. Renews monthly until you cancel\./);
    assert.match(copy, /Pay here\. Then sign in on this site\. We email a 6-digit code\./);
    assert.match(copy, /Sign in with the 6-digit code we email/);
    assert.match(copy, /Paid\. Sign in with the 6-digit code we email to that Stripe inbox\./);
    assert.match(copy, /That sign-in expired/);
    assert.match(copy, /This sign-in is not valid\./);
    assert.match(copy, /Signing you in/);
    assert.match(copy, /Allow FLOKS to connect this Grok Bot as this paying customer/);
    assert.match(copy, /Pairing is on \/setup/);
    assert.match(copy, /Hours bill while the computer is initializing, running, suspending, or resuming/);
    assert.match(copy, /Asleep and shutdown do not/);
    assert.match(copy, /Unused hours are not cash back/);
    assert.match(copy, /This page isn’t here\./);
    assert.match(copy, /Approve isn’t working\./);
    assert.doesNotMatch(copy, /Distributed Cognitive Architecture/);
    assert.doesNotMatch(copy, /Open the magic link from your billing email/);
    assert.doesNotMatch(copy, /Paste a pair code/);
    assert.doesNotMatch(copy, /Where does this Bot sit when the shared machine is full\?/);
    assert.doesNotMatch(copy, /Your Bots are capable of more/);
    assert.doesNotMatch(copy, /Operating Layer for Bot Crews/i);
    assert.doesNotMatch(copy, /The Missing Operating Layer/);
    assert.doesNotMatch(copy, /Your Grok Bot gets its own computer\./);
    const text = surface();
    assert.doesNotMatch(text, /Where does this Bot sit when the shared machine is full\?/);
    assert.doesNotMatch(text, /Your Bots are capable of more/);
    assert.doesNotMatch(text, /Operating Layer for Bot Crews/i);
    assert.doesNotMatch(text, /Join Waitlist/i);
    assert.doesNotMatch(text, /1429/);
    assert.doesNotMatch(text, /99\.999%/);
    assert.doesNotMatch(text, /quantum/i);
    assert.doesNotMatch(text, /bare-metal enclave/i);
    assert.doesNotMatch(text, /airgap/i);
    assert.doesNotMatch(text, /unlimited scaling/i);
    assert.doesNotMatch(text, /Interactive Inspection Ribbon/);
    assert.doesNotMatch(text, /Simulate Pair Request/);
    assert.doesNotMatch(text, /localStorage/);
    assert.doesNotMatch(text, /font-family:\s*Inter/i);
    assert.doesNotMatch(text, /Instrument_Serif/);
    assert.doesNotMatch(text, /href=["']\/architecture/);
    assert.doesNotMatch(text, /href=["']\/systems/);
    assert.doesNotMatch(text, /href=["']\/research/);
    assert.doesNotMatch(text, /href=["']\/evidence/);
    assert.doesNotMatch(text, /href=["']\/company/);
    const header = read("components/SiteHeader.tsx");
    assert.match(header, /FLOKS/);
    assert.match(header, /MANAGE_BILLING/);
    assert.match(header, /LOGOUT/);
    assert.match(header, /\/login/);
    assert.match(header, /Home/);
    assert.match(header, /Legal/);
    assert.match(read("app/page.tsx"), /<Hero/);
    assert.match(read("app/page.tsx"), /HeroHardwareNode|studio\/Hero/);
    assert.match(read("app/layout.tsx"), /Starfield/);
    assert.match(read("components/studio/HeroHardwareNode.tsx"), /DESK_01/);
    assert.equal(existsSync(join(WEB, "public/concept-boundary.png")), true);
    assert.match(read("components/studio/Concept.tsx"), /src="\/concept-boundary\.png"/);
    assert.match(read("components/studio/Concept.tsx"), /motion\.img/);
    assert.doesNotMatch(read("components/studio/Concept.tsx"), /inset-x-10 top-1\/2/);
    assert.match(read("components/studio/HeroHardwareNode.tsx"), /GROK MCP SUBSYSTEM/);
    assert.match(read("app/join/page.tsx"), /PlanGrid/);
    assert.match(read("components/studio/PlanGrid.tsx"), /Most Popular/);
    assert.match(read("components/studio/PlanGrid.tsx"), /md:grid-cols-3/);
    assert.doesNotMatch(read("app/page.tsx"), /hero-node/);
    assert.doesNotMatch(read("app/page.tsx"), /A workplace/);
    assert.doesNotMatch(text, /Entry to Asentxia/);
    assert.doesNotMatch(text, /omni_lux|14\.2TB|liquid-gold/);
    assert.doesNotMatch(header, /Join Waitlist/i);
    assert.doesNotMatch(header, /Architecture|Research|Evidence|Company/);
    assert.doesNotMatch(read("components/SetupGate.tsx"), /\bAllow\b/);
    assert.doesNotMatch(read("app/setup/page.tsx"), /\bAllow\b/);
    const footer = `${read("components/LegalFooter.tsx")}\n${read("lib/legal.ts")}\n${read("lib/copy.ts")}`;
    assert.match(footer, /Asentxia Systems/);
    assert.match(footer, /FOOTER_MARK/);
    assert.match(footer, /FOOTER_NAV/);
    assert.match(footer, /label: "Terms"/);
    assert.match(footer, /label: "Privacy"/);
    assert.match(footer, /label: "Acceptable Use"/);
    assert.match(footer, /label: "Refund"/);
    assert.match(footer, /label: "Cancellation"/);
    assert.match(footer, /label: "Data retention"/);
    assert.match(footer, /label: "Support"/);
    assert.doesNotMatch(read("lib/legal.ts"), /label: "Security"/);
    assert.doesNotMatch(read("lib/legal.ts"), /label: "Status"/);
    assert.doesNotMatch(read("components/LegalFooter.tsx"), /href="\/legal"/);
    assert.match(read("app/layout.tsx"), /default: "FLOKS"/);
    assert.match(read("app/not-found.tsx"), /href="\/"/);
    assert.match(read("app/not-found.tsx"), /href="\/legal"/);
    assert.match(read("components/AuthorizeCard.tsx"), /Allow/);
    assert.match(read("components/AuthorizeCard.tsx"), /Cancel/);
  });

  it("uses AI Studio tokens, not brown night-metal or lime-only hardware", () => {
    const css = read("app/globals.css");
    const layout = read("app/layout.tsx");
    assert.match(css, /#050505/);
    assert.match(css, /#0a0a0a/);
    assert.match(css, /#e3f2fd/);
    assert.match(css, /rgba\(10,\s*10,\s*10,\s*0\.4\)/);
    assert.match(css, /--r-pill:\s*9999px/);
    assert.match(css, /outline:\s*3px solid var\(--ice\)/);
    assert.doesNotMatch(css, /#18120d/);
    assert.doesNotMatch(css, /#c3f400/);
    assert.doesNotMatch(css, /#ccff00/);
    assert.doesNotMatch(css, /#f4efe6/);
    assert.doesNotMatch(css, /Times/);
    assert.match(layout, /Hanken_Grotesk/);
    assert.match(layout, /Manrope/);
    assert.match(layout, /JetBrains_Mono/);
    assert.doesNotMatch(layout, /Instrument_Serif/);
    assert.doesNotMatch(layout, /Geist/);
    assert.equal(existsSync(join(WEB, "code.html")), false);
    assert.equal(existsSync(join(WEB, "index.html")), false);
  });

  it("wires live Stripe Payment Links and same-origin setup actions", () => {
    const config = read("lib/config.ts");
    assert.match(config, /buy\.stripe\.com\/dRm5kv54s8FO5NR0ES6wE00/);
    assert.match(config, /buy\.stripe\.com\/dRm00b9kI2hqfor3R46wE01/);
    assert.match(config, /buy\.stripe\.com\/eVq28j7cA5tCccf1IW6wE02/);
    assert.match(config, /clientId: "floks-pc"/);
    assert.match(config, /scope: "mcp"/);
    assert.match(config, /\/oauth\/authorize/);
    assert.match(config, /\/oauth\/token/);
    assert.match(config, /\/api\/setup\/approve/);
    assert.match(config, /\/api\/setup\/deny/);
    assert.match(read("lib/legal.ts"), /WorkOS AuthKit/);
    assert.match(read("lib/legal.ts"), /Vercel/);
    assert.doesNotMatch(read("lib/legal.ts"), /GCP — the floks-pc.com host/);
    assert.match(read(".env.example"), /WORKOS_CLIENT_ID=/);
    assert.match(read(".env.example"), /STRIPE_SECRET_KEY=/);
    assert.match(read(".env.example"), /RUNLOOP_API_KEY=/);
    assert.doesNotMatch(read(".env.example"), /sk_live|sk_test|password_[A-Za-z0-9]{8,}/);
    const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
    assert.equal(pkg.dependencies?.zod, "^4.4.0");
    assert.equal(pkg.dependencies?.["@runloop/api-client"], "1.28.0");
    assert.match(read("next.config.ts"), /path\.join\(webModules, "zod"\)/);
  });

  it("keeps AUP at /legal/aup and legal substance", () => {
    const legal = read("lib/legal.ts");
    assert.match(legal, /path: "\/legal\/aup"/);
    assert.match(read("lib/config.ts"), /Adaptive Liquidity, Inc\./);
    assert.match(legal, /support@floks-pc.com/);
    assert.match(legal, /initializing, running, suspending, or resuming/);
    assert.match(legal, /We do not sell personal data/);
  });

  it("puts at most one KitMark on home and join, zero on legal", () => {
    const home = read("app/page.tsx");
    const join = read("app/join/page.tsx");
    const legalIndex = read("app/legal/page.tsx");
    const legalTerms = read("app/legal/terms/page.tsx");
    assert.equal(home.split("<KitMark").length - 1, 1);
    assert.equal(join.split("<KitMark").length - 1, 1);
    assert.equal(legalIndex.includes("KitMark"), false);
    assert.equal(legalTerms.includes("KitMark"), false);
    assert.equal(read("components/AuthorizeCard.tsx").includes("KitMark"), false);
    assert.equal(read("app/not-found.tsx").includes("KitMark"), false);
    const kit = read("lib/kit.ts");
    assert.match(kit, /KIT_SHAPES/);
    assert.match(kit, /KIT_COLORS/);
    for (const shape of ["circle", "blob", "square", "pill", "triangle", "hexagon", "cloud", "tear"]) {
      assert.match(kit, new RegExp(`"${shape}"`));
    }
    assert.doesNotMatch(kit, /"cube"|"capsule"|"squircle"|"diamond"|"trap"|"pent"/);
    for (const name of ["white", "brown", "red", "orange", "gold", "green", "teal", "blue", "purple", "pink", "gray"]) {
      assert.match(kit, new RegExp(`${name}:`));
    }
    assert.equal((kit.match(/"#/g) ?? []).length, 11);
    const desk = read("components/SetupDesk.tsx");
    assert.match(desk, /<details className="fallback">/);
    assert.ok(desk.indexOf("APPROVE_LABEL") < desk.indexOf("PASTE_FALLBACK"));
  });

  it("does not treat session_id as a login cookie", () => {
    const session = read("lib/session.ts");
    assert.match(session, /Never invent a cookie/i);
    const callback = read("app/callback/route.ts");
    assert.match(callback, /session_id/);
    assert.match(callback, /\/setup/);
    assert.match(callback, /authenticateAuthKitCode/);
    assert.doesNotMatch(callback, /document\.cookie/);
    assert.doesNotMatch(callback, /JSON\.stringify\(\{ id:/);
    assert.equal(callbackFinishPlan(new URLSearchParams("session_id=cs_test")).shouldPost, false);
    assert.equal(
      callbackFinishPlan(new URLSearchParams("session_id=cs_test")).nextHref,
      "/setup?session_id=cs_test",
    );
    assert.equal(callbackFinishPlan(new URLSearchParams()).shouldPost, false);
    assert.equal(callbackFinishPlan(new URLSearchParams()).nextHref, "/setup");
  });

  it("hard-disables public preview galleries on /setup", () => {
    const setup = read("app/setup/page.tsx");
    assert.doesNotMatch(setup, /previewSession\(/);
    assert.match(setup, /resolveSetupView/);
    assert.match(read("lib/preview.ts"), /NODE_ENV === "production"/);
    assert.match(read("lib/setup-server.ts"), /previewEnabled/);
    assert.doesNotMatch(setup, /hatch/);
    assert.doesNotMatch(read("components/SetupDesk.tsx"), /state-tester|Inspection Ribbon|scenario/i);
  });

  it("posts Manage billing as a browser form, not fetch+follow", () => {
    const client = read("lib/setup-client.ts");
    const start = client.indexOf("export function openPortal");
    assert.ok(start >= 0);
    const rest = client.slice(start);
    const next = rest.indexOf("\nexport ", 1);
    const portal = next === -1 ? rest : rest.slice(0, next);
    assert.match(portal, /createElement\("form"\)/);
    assert.match(portal, /method = "POST"/);
    assert.match(portal, /SETUP_ACTIONS\.portal/);
    assert.match(portal, /form\.submit\(/);
    assert.doesNotMatch(portal, /postForm/);
    assert.doesNotMatch(portal, /fetch\(/);
    assert.doesNotMatch(portal, /redirect:\s*"follow"/);
    const header = read("components/SiteHeader.tsx");
    assert.match(header, /openPortal\(/);
    assert.doesNotMatch(header, /await openPortal/);
  });

  it("keeps Allow off until authorize preflight has a success shape", () => {
    const card = read("components/AuthorizeCard.tsx");
    assert.match(card, /oauthUiFromPreflight/);
    assert.doesNotMatch(card, /setState\("ready"\)/);
    assert.equal(oauthUiFromPreflight(false, null).state, "error");
    assert.equal(oauthUiFromPreflight(false, {}).state, "error");
    assert.equal(oauthUiFromPreflight(true, null).state, "error");
    assert.equal(oauthUiFromPreflight(true, {}).state, "error");
    assert.equal(oauthUiFromPreflight(true, parseAuthorizePreflightBody("not-json")).state, "error");
    assert.equal(oauthUiFromPreflight(false, { error: "invalid_client" }).state, "invalid_client");
    assert.equal(oauthUiFromPreflight(true, { error: "invalid_client" }).state, "invalid_client");
    assert.equal(oauthUiFromPreflight(false, { error: "already_allowed" }).state, "already_allowed");
    assert.equal(oauthUiFromPreflight(true, { status: "already_allowed" }).state, "already_allowed");
    assert.equal(oauthUiFromPreflight(false, { error: "invalid_request" }).state, "error");
    assert.equal(oauthUiFromPreflight(true, { status: "ready" }).state, "ready");
    assert.equal(oauthUiFromPreflight(true, { status: "ok" }).state, "ready");
    assert.equal(oauthUiFromPreflight(true, { ok: true }).state, "ready");
    assert.equal(oauthUiFromPreflight(false, { status: "ready" }).state, "error");
    assert.equal(oauthUiFromPreflight(true, { ok: false }).state, "error");
  });
});
