import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Phrases that must not appear in public copy. Definitions live in this test helper, not on the site. */
export const OVERCLAIM_PHRASES = [
  "powered by continuum",
  "runs continuum",
  "continuum today",
  "controlled execution",
  "scoped permissions armed",
  "persistent state",
  "full execution",
  "scoped signed permissions",
  "signed permissions",
  "every action has signed proof",
  "ships nov 1",
  "announced nov 1",
  "instant revocation",
  "instant revoke",
  "tamper-evident",
  "tamper evident",
  "audit trail",
  "perfect security",
  "production-ready",
  "cognitive interface",
  "revolutionary",
  "seamless",
] as const;

const WORD_PHRASES = ["governed", "floks", "statxion", "stations"] as const;

const DRAFT_PRICE_PATTERNS: RegExp[] = [
  /\$\s*29(?:\.00)?(?!\d)/u,
  /\$\s*99(?:\.00)?(?!\d)/u,
  /\$\s*79(?:\.00)?(?!\d)/u,
  /\$\s*1\.20\b/u,
  /\$\s*1\.10\b/u,
  /\b1\.20\s*\/\s*h\b/iu,
  /\b(?:29|99)\s*\/\s*mo\b/iu,
  /\b79\s*\/\s*agent\b/iu,
  /\b79\s+per\s+agent\b/iu,
];

const REGION_RE =
  /\/\*\s*(research-quote|banlist-definition)-start\s*\*\/[\s\S]*?\/\*\s*\1-end\s*\*\//gu;
const HTML_REGION_RE =
  /<!--\s*(research-quote|banlist-definition)-start\s*-->[\s\S]*?<!--\s*\1-end\s*-->/gu;

const DENIAL_RE = /\b(not|no|never|don't|do not|isn't|is not|cannot|can't)\b/iu;

export type PublicCopyHit = {
  kind: "overclaim" | "price";
  phrase: string;
  excerpt: string;
};

export function stripExcludedCopy(source: string): string {
  return source.replace(REGION_RE, " ").replace(HTML_REGION_RE, " ");
}

function prose(source: string): string {
  return stripExcludedCopy(source).replace(/<[^>]+>/gu, " ");
}

function deniedBefore(text: string, index: number): boolean {
  const start = Math.max(0, index - 96);
  const window = text.slice(start, index);
  const breakAt = Math.max(window.lastIndexOf("."), window.lastIndexOf("!"), window.lastIndexOf("?"), window.lastIndexOf("\n"));
  const local = breakAt >= 0 ? window.slice(breakAt + 1) : window;
  return DENIAL_RE.test(local);
}

function pushHit(hits: PublicCopyHit[], kind: PublicCopyHit["kind"], phrase: string, text: string, index: number): void {
  const excerpt = text.slice(Math.max(0, index - 40), index + phrase.length + 40).replace(/\s+/gu, " ").trim();
  if (!hits.some((hit) => hit.phrase === phrase && hit.excerpt === excerpt)) {
    hits.push({ kind, phrase, excerpt });
  }
}

export function publicCopyViolations(source: string): PublicCopyHit[] {
  const text = prose(source);
  const flat = text.replace(/\s+/gu, " ");
  const hits: PublicCopyHit[] = [];

  for (const phrase of OVERCLAIM_PHRASES) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu");
    for (const match of flat.matchAll(re)) {
      const index = match.index ?? 0;
      if (!deniedBefore(flat, index)) pushHit(hits, "overclaim", phrase, flat, index);
    }
  }

  for (const phrase of WORD_PHRASES) {
    // floks-pc is the retired hostname operators are told not to use. The product-name ban still matches a bare FLOKS.
    const source = phrase === "floks" ? "\\bfloks\\b(?!-pc)" : `\\b${phrase}\\b`;
    const re = new RegExp(source, "giu");
    for (const match of flat.matchAll(re)) {
      const index = match.index ?? 0;
      if (!deniedBefore(flat, index)) pushHit(hits, "overclaim", phrase, flat, index);
    }
  }

  if (flat.includes("∞") && !deniedBefore(flat, flat.indexOf("∞"))) {
    pushHit(hits, "overclaim", "∞", flat, flat.indexOf("∞"));
  }

  if (/(?:^|[^0-9])24\s*\/\s*7(?:[^0-9]|$)/u.test(flat)) {
    const index = flat.search(/24\s*\/\s*7/u);
    if (index >= 0 && !deniedBefore(flat, index)) pushHit(hits, "overclaim", "24/7", flat, index);
  }

  for (const pattern of DRAFT_PRICE_PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    for (const match of text.matchAll(re)) {
      const index = match.index ?? 0;
      pushHit(hits, "price", match[0] ?? pattern.source, text, index);
    }
  }

  return hits;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const file = join(dir, name);
    const stat = statSync(file);
    if (stat.isDirectory()) walk(file, out);
    else out.push(file);
  }
}

export function publicCopyFiles(root = ROOT): string[] {
  const files: string[] = [];
  walk(join(root, "web", "app"), files);
  walk(join(root, "web", "components"), files);
  files.push(
    join(root, "web", "lib", "copy.ts"),
    join(root, "web", "lib", "legal.ts"),
    join(root, "web", "lib", "config.ts"),
    join(root, "web", "lib", "billing", "catalog.ts"),
    join(root, "web", "README.md"),
    join(root, "docs", "DEPLOY.md"),
    join(root, "docs", "STRIPE_GO_LIVE.md"),
  );
  return files.filter((file) => /\.(ts|tsx|md)$/u.test(file));
}

export function publicCopyViolationsInTree(root = ROOT): string[] {
  const hits: string[] = [];
  for (const file of publicCopyFiles(root)) {
    const rel = relative(root, file).replaceAll("\\", "/");
    if (rel.endsWith("internal-draft-prices.ts")) continue;
    for (const hit of publicCopyViolations(readFileSync(file, "utf8"))) {
      hits.push(`${rel}: ${hit.kind}: ${hit.phrase}: ${hit.excerpt}`);
    }
  }
  return hits;
}
