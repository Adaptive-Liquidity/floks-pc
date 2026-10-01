import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { listMigrationFiles, SCHEMA_MIGRATIONS_SQL } from "../../scripts/migrate.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const CLAIM_PHRASES = [
  "residential proxies",
  "bot-detection bypass",
  "production-ready",
  "nexus-iq",
  "multi-vera",
  "host migration",
  "formal verification",
  "full dca",
  "nela",
];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const file = join(dir, name);
    const stat = statSync(file);
    if (stat.isDirectory()) walk(file, out);
    else out.push(file);
  }
}

function isDenial(text: string): boolean {
  return /\b(not|no|never|don't|do not|isn't|is not)\b/iu.test(text);
}

export function claimViolations(source: string): string[] {
  const found: string[] = [];
  let sectionDenial = false;
  const lines = source.split(/\r?\n/u);
  for (const line of lines) {
    const heading = line.match(/<h[1-3][^>]*>([^<]+)/u);
    if (heading?.[1]) sectionDenial = isDenial(heading[1]);
    const lowered = line.toLowerCase();
    const denied = sectionDenial || isDenial(line);
    if (!denied) {
      for (const phrase of CLAIM_PHRASES) {
        if (lowered.includes(phrase)) found.push(line.trim());
      }
      if (/\b(continuum|\bdca\b|handoffs?|mediated)\b/iu.test(line) && /\b(live|available|working)\b/iu.test(line)) {
        found.push(line.trim());
      }
    }
  }
  return found;
}

function publicSources(): string[] {
  const files: string[] = [];
  walk(join(ROOT, "web", "app"), files);
  walk(join(ROOT, "web", "components"), files);
  files.push(join(ROOT, "web", "lib", "copy.ts"), join(ROOT, "web", "lib", "legal.ts"));
  return files.filter((file) => /\.(ts|tsx)$/u.test(file));
}

describe("launch guards", () => {
  it("installs web dependencies before the root verify", () => {
    const yaml = readFileSync(join(ROOT, ".github/workflows/verify.yml"), "utf8");
    const verifyJob = yaml.slice(yaml.indexOf("\n  verify:"));
    const webInstall = verifyJob.indexOf("npm ci --prefix web");
    const rootVerify = verifyJob.indexOf("run: npm run verify\n");
    assert.ok(webInstall !== -1 && rootVerify !== -1 && webInstall < rootVerify);
  });

  it("records applied sql files in schema_migrations, in order", () => {
    assert.match(SCHEMA_MIGRATIONS_SQL, /CREATE TABLE IF NOT EXISTS schema_migrations/u);
    const names = listMigrationFiles(join(ROOT, "migrations"));
    assert.deepEqual(names, [
      "0001_node_computers.sql",
      "0002_c4_capabilities.sql",
      "0003_web_seats.sql",
      "0004_launch_store.sql",
    ]);
  });

  it("rejects a hard-coded public host outside the retired-host guard", () => {
    const files: string[] = [];
    walk(join(ROOT, "web"), files);
    const hits: string[] = [];
    for (const file of files) {
      if (!/\.(ts|tsx)$/u.test(file)) continue;
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      const text = readFileSync(file, "utf8");
      if (/https?:\/\/[a-z0-9.-]*vercel\.app/iu.test(text)) hits.push(rel);
      if (/(?<![\w@])asentxia\.com/iu.test(text)) hits.push(rel);
      if (/floks-pc\.com/iu.test(text) && rel !== "web/lib/app-url.ts") hits.push(rel);
    }
    assert.deepEqual(hits, []);
  });

  it("does not claim unbuilt or forbidden capabilities", () => {
    const hits: string[] = [];
    for (const file of publicSources()) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      for (const line of claimViolations(readFileSync(file, "utf8"))) {
        hits.push(`${rel}: ${line}`);
      }
    }
    assert.deepEqual(hits, []);
  });

  it("still flags a live Continuum claim and a bare residential-proxy claim", () => {
    assert.equal(claimViolations("Continuum is available now").length > 0, true);
    assert.equal(claimViolations("residential proxies").length > 0, true);
    assert.deepEqual(claimViolations("<h2>Not for sale</h2>\nresidential proxies"), []);
  });
});
