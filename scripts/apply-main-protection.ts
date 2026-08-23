/**
 * Create or update the "Protect main" repository ruleset.
 *
 * Requires a token with Administration permission:
 *
 *   GH_ADMIN_TOKEN=... npm run protect:main
 *
 * Default GITHUB_TOKEN from Actions cannot change rulesets.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

type RulesetListItem = { id: number; name: string };
type RulesetPayload = { name: string } & Record<string, unknown>;

function repoFromEnv(): { owner: string; repo: string } {
  const spec = process.env.GITHUB_REPOSITORY ?? "Adaptive-Liquidity/floks-pc";
  const [owner, repo] = spec.split("/");
  if (!owner || !repo) {
    throw new Error(`invalid GITHUB_REPOSITORY: ${spec}`);
  }
  return { owner, repo };
}

function tokenFromEnv(): string {
  const token = process.env.GH_ADMIN_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    throw new Error("GH_ADMIN_TOKEN (or GITHUB_TOKEN) is required");
  }
  return token;
}

function rulesetPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../.github/rulesets/main-protection.json");
}

async function gh<T>(
  token: string,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "floks-pc-main-protection",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = (text.length === 0 ? null : JSON.parse(text)) as T;
  return { status: res.status, data };
}

export async function applyMainProtection(): Promise<{ action: "created" | "updated"; id: number }> {
  const token = tokenFromEnv();
  const { owner, repo } = repoFromEnv();
  const payload = JSON.parse(readFileSync(rulesetPath(), "utf8")) as RulesetPayload;
  const listed = await gh<RulesetListItem[] | { message?: string }>(
    token,
    "GET",
    `/repos/${owner}/${repo}/rulesets`,
  );
  if (listed.status === 401 || listed.status === 403) {
    throw new Error(
      `cannot read rulesets (${listed.status}). Need a token with Administration on ${owner}/${repo}.`,
    );
  }
  if (listed.status >= 400) {
    throw new Error(`list rulesets failed: ${listed.status} ${JSON.stringify(listed.data)}`);
  }
  const existing = (listed.data as RulesetListItem[]).find((r) => r.name === payload.name);
  if (existing) {
    const updated = await gh<{ id: number; message?: string }>(
      token,
      "PUT",
      `/repos/${owner}/${repo}/rulesets/${existing.id}`,
      payload,
    );
    if (updated.status >= 400) {
      throw new Error(`update ruleset failed: ${updated.status} ${JSON.stringify(updated.data)}`);
    }
    return { action: "updated", id: existing.id };
  }
  const created = await gh<{ id: number; message?: string }>(
    token,
    "POST",
    `/repos/${owner}/${repo}/rulesets`,
    payload,
  );
  if (created.status >= 400) {
    throw new Error(`create ruleset failed: ${created.status} ${JSON.stringify(created.data)}`);
  }
  return { action: "created", id: created.data.id };
}

export async function main(): Promise<void> {
  const result = await applyMainProtection();
  console.log(`Protect main ruleset ${result.action} (id ${result.id})`);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  void main();
}
