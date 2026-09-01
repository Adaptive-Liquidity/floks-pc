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

  it("keeps locked copy and kills live marketing lines", () => {
    const copy = read("lib/copy.ts");
    assert.match(copy, /Where does this Bot sit when the shared machine is full\?/);
    assert.match(copy, /Open the magic link from your billing email/);
    assert.match(copy, /session_id is not login/);
    assert.match(copy, /We can send another to the same billing email/);
    assert.match(copy, /Signing you in/);
    assert.match(copy, /Allow FLOKS to connect this Grok Bot as this paying customer/);
    assert.match(
      copy,
      /Hours billed: initializing, running, suspending, resuming/,
    );
    assert.match(copy, /Asleep and shutdown do not/);
    assert.match(copy, /Unused hours are not cash-back/);
    assert.doesNotMatch(copy, /Your Grok Bot gets its own computer\./);
    const surface = walk(join(WEB, "app"))
      .concat(walk(join(WEB, "components")))
      .filter((path) => path.endsWith(".tsx") || path.endsWith(".ts") || path.endsWith(".css"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    assert.doesNotMatch(surface, /Your Grok Bot gets its own computer\./);
    assert.doesNotMatch(surface, /Agent Computer\./);
    assert.doesNotMatch(surface, /Join Waitlist/i);
    assert.doesNotMatch(surface, /font-family:\s*Inter/i);
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
