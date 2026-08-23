/**
 * PR merge-gate: review threads must be classified in a *reply*, valid
 * findings must cite a fix commit on the branch, and threads must be resolved.
 *
 * Protocol (see .github/MERGE_GATE.md):
 *
 *   VALIDITY: confirmed | partially-confirmed | unsupported | stale | question | out-of-scope
 *   ACTION: must-fix | should-fix | no-change | defer
 *   FIX: <sha> | none
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const VALIDITY_VALUES = [
  "confirmed",
  "partially-confirmed",
  "unsupported",
  "stale",
  "question",
  "out-of-scope",
] as const;

export type Validity = (typeof VALIDITY_VALUES)[number];

export const ACTION_VALUES = ["must-fix", "should-fix", "no-change", "defer"] as const;
export type Action = (typeof ACTION_VALUES)[number];

export type Classification = {
  validity: Validity;
  action: Action;
  fix: string | undefined;
};

export type ReviewComment = {
  author: string;
  body: string;
};

export type ReviewThread = {
  id: string;
  path: string | null;
  isResolved: boolean;
  isOutdated: boolean;
  comments: ReviewComment[];
};

export type ThreadVerdict = {
  ok: boolean;
  thread: ReviewThread;
  reason?: string;
  classification?: Classification;
};

export type GateResult = {
  ok: boolean;
  verdicts: ThreadVerdict[];
};

const VALIDITY_ALIASES: Record<string, Validity> = {
  confirmed: "confirmed",
  "partially-confirmed": "partially-confirmed",
  "partially confirmed": "partially-confirmed",
  unsupported: "unsupported",
  stale: "stale",
  question: "question",
  "out-of-scope": "out-of-scope",
  "out of scope": "out-of-scope",
};

const ACTION_ALIASES: Record<string, Action> = {
  "must-fix": "must-fix",
  "must fix": "must-fix",
  must_fix: "must-fix",
  "should-fix": "should-fix",
  "should fix": "should-fix",
  should_fix: "should-fix",
  "no-change": "no-change",
  "no change": "no-change",
  "no code change": "no-change",
  defer: "defer",
};

const FINDING_ACTIONS: ReadonlySet<Action> = new Set(["must-fix", "should-fix"]);
const FINDING_VALIDITY: ReadonlySet<Validity> = new Set(["confirmed", "partially-confirmed"]);
const REJECT_VALIDITY: ReadonlySet<Validity> = new Set([
  "unsupported",
  "stale",
  "question",
  "out-of-scope",
]);

const SHA_RE = /^[0-9a-f]{7,40}$/i;

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ");
}

function labeledValue(body: string, labels: readonly string[]): string | undefined {
  const labelAlt = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const inline = new RegExp(`^(?:#{1,6}\\s*)?(?:${labelAlt})\\s*[:\\-]\\s*(\\S[^\\n]*)$`, "im");
  const inlineMatch = inline.exec(body);
  if (inlineMatch?.[1]?.trim()) {
    return inlineMatch[1].trim();
  }
  const block = new RegExp(`^(?:#{1,6}\\s*)?(?:${labelAlt})\\s*[:\\-]?\\s*$`, "im");
  const blockMatch = block.exec(body);
  if (!blockMatch) {
    return undefined;
  }
  const after = body.slice(blockMatch.index + blockMatch[0].length);
  for (const line of after.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (/^(VALIDITY|ACTION|FIX|EVIDENCE|RISK|COMMENT)\b/i.test(trimmed)) {
      return undefined;
    }
    return trimmed;
  }
  return undefined;
}

export function parseClassification(body: string): Classification | null {
  const validityRaw = labeledValue(body, ["VALIDITY"]);
  const actionRaw = labeledValue(body, ["ACTION"]);
  if (!validityRaw || !actionRaw) {
    return null;
  }
  const validity = VALIDITY_ALIASES[normalizeToken(validityRaw)];
  const action = ACTION_ALIASES[normalizeToken(actionRaw)];
  if (!validity || !action) {
    return null;
  }
  const fixRaw = labeledValue(body, ["FIX"]);
  let fix: string | undefined;
  if (fixRaw) {
    const token = fixRaw.trim();
    if (normalizeToken(token) === "none") {
      fix = "none";
    } else if (SHA_RE.test(token)) {
      fix = token.toLowerCase();
    } else {
      return null;
    }
  }
  return { validity, action, fix };
}

export function lastClassification(thread: ReviewThread): Classification | null {
  const replies = thread.comments.slice(1);
  for (let i = replies.length - 1; i >= 0; i -= 1) {
    const parsed = parseClassification(replies[i]?.body ?? "");
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

export type EvaluateOptions = {
  requireResolved?: boolean;
  headSha?: string;
  isAncestor?: (fixSha: string, headSha: string) => boolean;
};

export function consistencyError(classification: Classification): string | undefined {
  if (FINDING_VALIDITY.has(classification.validity) && FINDING_ACTIONS.has(classification.action)) {
    return undefined;
  }
  if (FINDING_VALIDITY.has(classification.validity) && classification.action === "defer") {
    return undefined;
  }
  if (FINDING_VALIDITY.has(classification.validity) && classification.action === "no-change") {
    return `VALIDITY ${classification.validity} cannot use ACTION no-change (use must-fix, should-fix, or defer)`;
  }
  if (REJECT_VALIDITY.has(classification.validity) && FINDING_ACTIONS.has(classification.action)) {
    return `VALIDITY ${classification.validity} cannot use ACTION ${classification.action} (use no-change or defer)`;
  }
  if (REJECT_VALIDITY.has(classification.validity)) {
    return undefined;
  }
  return `VALIDITY ${classification.validity} is incompatible with ACTION ${classification.action}`;
}

export function evaluateThread(thread: ReviewThread, options: EvaluateOptions = {}): ThreadVerdict {
  const requireResolved = options.requireResolved !== false;
  const classification = lastClassification(thread);
  if (!classification) {
    return {
      ok: false,
      thread,
      reason:
        "no merge-gate classification in a reply (VALIDITY + ACTION must appear in a reply, not only the original comment)",
    };
  }
  const inconsistent = consistencyError(classification);
  if (inconsistent) {
    return { ok: false, thread, reason: inconsistent, classification };
  }
  if (FINDING_VALIDITY.has(classification.validity) && FINDING_ACTIONS.has(classification.action)) {
    if (!classification.fix || classification.fix === "none") {
      return {
        ok: false,
        thread,
        reason: "confirmed/partially-confirmed must-fix/should-fix requires FIX: <commit sha on this branch>",
        classification,
      };
    }
    if (options.headSha && options.isAncestor && !options.isAncestor(classification.fix, options.headSha)) {
      return {
        ok: false,
        thread,
        reason: `FIX ${classification.fix} is not an ancestor of HEAD ${options.headSha}`,
        classification,
      };
    }
  }
  if (requireResolved && !thread.isResolved) {
    return {
      ok: false,
      thread,
      reason: "thread is classified but still unresolved — resolve after the reply",
      classification,
    };
  }
  return { ok: true, thread, classification };
}

export function evaluateThreads(threads: ReviewThread[], options: EvaluateOptions = {}): GateResult {
  const verdicts = threads.map((thread) => evaluateThread(thread, options));
  return { ok: verdicts.every((v) => v.ok), verdicts };
}

type GraphqlComment = { author: { login: string } | null; body: string };
type GraphqlCommentConn = {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: GraphqlComment[];
};
type GraphqlThreadNode = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path?: string | null;
  comments: GraphqlCommentConn;
};

type GithubEvent = {
  pull_request?: { number?: number; head?: { sha?: string } };
  issue?: { number?: number; pull_request?: unknown };
};

function readEvent(eventPath: string): GithubEvent {
  return JSON.parse(readFileSync(eventPath, "utf8")) as GithubEvent;
}

function prNumberFromEnv(event: GithubEvent, env: NodeJS.ProcessEnv): number | undefined {
  if (typeof event.pull_request?.number === "number") {
    return event.pull_request.number;
  }
  if (event.issue?.pull_request && typeof event.issue.number === "number") {
    return event.issue.number;
  }
  const explicit = env.MERGE_GATE_PR;
  if (explicit) {
    const n = Number(explicit);
    if (Number.isInteger(n) && n > 0) {
      return n;
    }
  }
  return undefined;
}

function repoFromEnv(env: NodeJS.ProcessEnv): { owner: string; repo: string } {
  const spec = env.GITHUB_REPOSITORY;
  if (!spec || !spec.includes("/")) {
    throw new Error("GITHUB_REPOSITORY is required (owner/repo)");
  }
  const [owner, repo] = spec.split("/");
  if (!owner || !repo) {
    throw new Error(`invalid GITHUB_REPOSITORY: ${spec}`);
  }
  return { owner, repo };
}

async function githubGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "floks-pc-merge-gate",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (!res.ok || payload.errors?.length) {
    const detail = payload.errors?.map((e) => e.message).join("; ") ?? JSON.stringify(payload);
    throw new Error(`GitHub GraphQL ${res.status}: ${detail}`);
  }
  if (!payload.data) {
    throw new Error("GitHub GraphQL returned no data");
  }
  return payload.data;
}

const THREADS_QUERY = `
query ($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          comments(first: 50) {
            pageInfo { hasNextPage endCursor }
            nodes { author { login } body }
          }
        }
      }
    }
  }
}
`;

const MORE_COMMENTS_QUERY = `
query ($id: ID!, $cursor: String!) {
  node(id: $id) {
    ... on PullRequestReviewThread {
      comments(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { author { login } body }
      }
    }
  }
}
`;

function toComments(nodes: GraphqlComment[]): ReviewComment[] {
  return nodes.map((c) => ({
    author: c.author?.login ?? "ghost",
    body: c.body,
  }));
}

type ThreadsConn = {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: GraphqlThreadNode[];
};

type ThreadsQueryData = {
  repository: { pullRequest: { reviewThreads: ThreadsConn } | null } | null;
};

type MoreCommentsQueryData = {
  node: { comments: GraphqlCommentConn } | null;
};

async function fetchThreads(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<ReviewThread[]> {
  const threads: ReviewThread[] = [];
  let cursor: string | null = null;
  for (;;) {
    const data: ThreadsQueryData = await githubGraphql<ThreadsQueryData>(token, THREADS_QUERY, {
      owner,
      name: repo,
      number,
      cursor,
    });
    const conn: ThreadsConn | undefined = data.repository?.pullRequest?.reviewThreads;
    if (!conn) {
      throw new Error(`pull request #${number} not found`);
    }
    for (const node of conn.nodes) {
      const comments = toComments(node.comments.nodes);
      let commentCursor = node.comments.pageInfo.hasNextPage ? node.comments.pageInfo.endCursor : null;
      while (commentCursor) {
        const more: MoreCommentsQueryData = await githubGraphql<MoreCommentsQueryData>(
          token,
          MORE_COMMENTS_QUERY,
          { id: node.id, cursor: commentCursor },
        );
        const page = more.node?.comments;
        if (!page) {
          break;
        }
        comments.push(...toComments(page.nodes));
        commentCursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      }
      threads.push({
        id: node.id,
        path: node.path ?? null,
        isResolved: node.isResolved,
        isOutdated: node.isOutdated,
        comments,
      });
    }
    if (!conn.pageInfo.hasNextPage) {
      break;
    }
    cursor = conn.pageInfo.endCursor;
  }
  return threads;
}

export function gitIsAncestor(fixSha: string, headSha: string, cwd = process.cwd()): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", fixSha, headSha], {
    cwd,
    stdio: "ignore",
  });
  return result.status === 0;
}

function threadLabel(thread: ReviewThread): string {
  const preview = thread.comments[0]?.body.trim().split(/\n/)[0]?.slice(0, 80) ?? "(empty)";
  const loc = thread.path ?? "unknown path";
  return `${loc}: ${preview}`;
}

export function formatReport(result: GateResult): string {
  const lines: string[] = ["## merge-gate", ""];
  if (result.verdicts.length === 0) {
    lines.push("No review threads. Gate passes.");
    return lines.join("\n");
  }
  for (const verdict of result.verdicts) {
    const mark = verdict.ok ? "PASS" : "FAIL";
    const extra = verdict.ok
      ? `${verdict.classification?.validity} / ${verdict.classification?.action}`
      : (verdict.reason ?? "unknown failure");
    lines.push(`- **${mark}** ${threadLabel(verdict.thread)} — ${extra}`);
  }
  lines.push("");
  lines.push(result.ok ? "All review threads classified, fixed when required, and resolved." : "Gate failed.");
  return lines.join("\n");
}

export async function runMergeGate(env: NodeJS.ProcessEnv = process.env): Promise<{
  ok: boolean;
  skipped?: string;
  report: string;
}> {
  const event = env.GITHUB_EVENT_PATH ? readEvent(env.GITHUB_EVENT_PATH) : {};
  const number = prNumberFromEnv(event, env);
  if (!number) {
    return { ok: true, skipped: "not a pull request event", report: "merge-gate skipped (no PR number)" };
  }
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }
  const { owner, repo } = repoFromEnv(env);
  const threads = await fetchThreads(token, owner, repo, number);
  const headSha = event.pull_request?.head?.sha ?? env.GITHUB_SHA;
  const result = evaluateThreads(threads, {
    requireResolved: env.MERGE_GATE_REQUIRE_RESOLVED !== "false",
    headSha,
    isAncestor: headSha ? gitIsAncestor : undefined,
  });
  return { ok: result.ok, report: formatReport(result) };
}

export async function main(): Promise<void> {
  const { ok, report, skipped } = await runMergeGate();
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, `${report}\n`);
  }
  console.log(report);
  if (skipped) {
    console.log(`skipped: ${skipped}`);
  }
  if (!ok) {
    process.exitCode = 1;
  }
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
