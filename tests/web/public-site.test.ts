import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

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
      "app/setup/page.tsx",
      "app/callback/page.tsx",
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
  });

  it("does not ship forbidden public routes", () => {
    const forbidden = [
      "signup",
      "register",
      "login",
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
    ];
    for (const name of forbidden) {
      assert.equal(existsSync(join(WEB, "app", name)), false, name);
    }
  });

  it("keeps locked copy and kills mock lines", () => {
    const copy = read("lib/copy.ts");
    assert.match(copy, /Where does this Bot sit when the shared machine is full\?/);
    assert.match(copy, /Pick a desk\./);
    assert.match(copy, /Spark — \$19\/mo — 8 hours — 1 computer/);
    assert.match(copy, /Desk — \$39\/mo — 25 hours — 1 computer/);
    assert.match(copy, /Shift — \$69\/mo — 60 hours — 1 computer/);
    assert.match(copy, /Same eight tools on every desk\. Renews monthly until you cancel\./);
    assert.match(copy, /Give this URL to the Bot you paid for\./);
    assert.match(copy, /Open the magic link from your billing email/);
    assert.match(copy, /This tab is not the login/);
    assert.match(copy, /That link is done\. We can send another to the same billing email/);
    assert.match(copy, /That link isn’t valid\./);
    assert.match(copy, /Signing you in/);
    assert.match(copy, /Allow FLOKS to connect this Grok Bot as this paying customer/);
    assert.match(copy, /Pairing is on \/setup/);
    assert.match(copy, /Hours bill while the computer is initializing, running, suspending, or resuming/);
    assert.match(copy, /Asleep and shutdown do not/);
    assert.match(copy, /Unused hours are not cash back/);
    assert.match(copy, /This page isn’t here\./);
    assert.doesNotMatch(copy, /Your Bots are capable of more/);
    assert.doesNotMatch(copy, /Operating Layer for Bot Crews/i);
    assert.doesNotMatch(copy, /The Missing Operating Layer/);
    assert.doesNotMatch(copy, /First operational layer/);
    assert.doesNotMatch(copy, /An environment that outlives the request/);
    assert.doesNotMatch(copy, /Your Grok Bot gets its own computer\./);
    const text = surface();
    assert.doesNotMatch(text, /Your Bots are capable of more/);
    assert.doesNotMatch(text, /Operating Layer for Bot Crews/i);
    assert.doesNotMatch(text, /The Missing Operating Layer/);
    assert.doesNotMatch(text, /Join Waitlist/i);
    assert.doesNotMatch(text, /manual approval/i);
    assert.doesNotMatch(text, /experimental pairing/i);
    assert.doesNotMatch(text, /© 2024 FLOKS Agent Computer/);
    assert.doesNotMatch(text, /Agent Computer\./);
    assert.doesNotMatch(text, /Watch a Crew Work/i);
    assert.doesNotMatch(text, /font-family:\s*Inter/i);
    assert.doesNotMatch(text, /Instrument_Serif/);
    assert.doesNotMatch(text, /\bNodes\b.*\bMascots\b|\bMascots\b.*\bWorkspaces\b/);
    const footer = `${read("components/LegalFooter.tsx")}\n${read("lib/legal.ts")}`;
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

  it("uses Stitch product tokens on the live routes, not brown night-metal", () => {
    const css = read("app/globals.css");
    const layout = read("app/layout.tsx");
    assert.match(css, /#131313/);
    assert.match(css, /#d3fd64/);
    assert.match(css, /#e5e2e1/);
    assert.match(css, /rgba\(26,\s*26,\s*26,\s*0\.6\)/);
    assert.match(css, /--r-card:\s*8px/);
    assert.match(css, /--r-pill:\s*999px/);
    assert.doesNotMatch(css, /#18120d/);
    assert.doesNotMatch(css, /#c3f400/);
    assert.doesNotMatch(css, /#f4efe6/);
    assert.match(layout, /Geist/);
    assert.match(layout, /Space_Grotesk/);
    assert.match(layout, /JetBrains_Mono/);
    assert.doesNotMatch(layout, /Instrument_Serif/);
    assert.equal(existsSync(join(WEB, "code.html")), false);
    assert.equal(existsSync(join(WEB, "index.html")), false);
  });

  it("wires live Stripe Payment Links and connector fields", () => {
    const config = read("lib/config.ts");
    assert.match(config, /buy\.stripe\.com\/dRm5kv54s8FO5NR0ES6wE00/);
    assert.match(config, /buy\.stripe\.com\/dRm00b9kI2hqfor3R46wE01/);
    assert.match(config, /buy\.stripe\.com\/eVq28j7cA5tCccf1IW6wE02/);
    assert.match(config, /clientId: "floks-pc"/);
    assert.match(config, /scope: "mcp"/);
    assert.match(config, /\/oauth\/authorize/);
    assert.match(config, /\/oauth\/token/);
    assert.match(config, /\/setup\/approve/);
    assert.match(config, /\/setup\/deny/);
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
    const kit = read("lib/kit.ts");
    assert.match(kit, /KIT_SHAPES/);
    assert.match(kit, /KIT_COLORS/);
    assert.equal((kit.match(/"#/g) ?? []).length, 11);
  });

  it("does not treat session_id as a login cookie", () => {
    const session = read("lib/session.ts");
    assert.match(session, /never mint from session_id|Never invent a cookie/i);
    const callback = read("components/CallbackFlash.tsx");
    assert.match(callback, /session_id/);
    assert.match(callback, /\/setup/);
    assert.doesNotMatch(callback, /document\.cookie/);
  });
});
