/**
 * Path jail helpers.
 * Every filesystem operation must run user paths through assertInsideRoot.
 */

import { PathEscape } from "./errors.js";
import { posix as pathPosix } from "node:path";
import type { ComputerProviderName } from "./types.js";

const DEFAULT_ROOT = "/home/flok";

/** Documented Bot-facing prefixes. Rewrite is segment-bounded, never `/workspaceevil`. */
export const WORKSPACE_ALIAS_PREFIXES = [
  "/home/user/flok",
  "/home/flok",
  "/workspace",
] as const;

/**
 * Canonicalize and ensure the resolved path stays inside root.
 * Rejects ../, absolute escapes, null bytes, and empty segments that would leave the jail.
 * Returns the absolute canonical path that is guaranteed to be under root.
 */
export function assertInsideRoot(
  userPath: string,
  root: string = DEFAULT_ROOT,
): string {
  if (typeof userPath !== "string" || userPath.length === 0) {
    throw new PathEscape(userPath ?? "");
  }
  if (userPath.includes("\0")) {
    throw new PathEscape(userPath);
  }

  const normalizedRoot = stripTrailingSlash(pathPosix.normalize(root));
  const rootWithSep = normalizedRoot.endsWith("/")
    ? normalizedRoot
    : normalizedRoot + "/";

  // Relative paths join under root. Absolute paths must already be inside root.
  const candidate = stripTrailingSlash(
    userPath.startsWith("/")
      ? pathPosix.normalize(userPath)
      : pathPosix.normalize(pathPosix.join(normalizedRoot, userPath)),
  );

  if (candidate !== normalizedRoot && !candidate.startsWith(rootWithSep)) {
    throw new PathEscape(userPath);
  }

  // Reject device / proc / sys style paths even if somehow under root
  const lower = candidate.toLowerCase();
  if (
    lower.includes("/proc/") ||
    lower.includes("/sys/") ||
    lower.includes("/dev/") ||
    lower.endsWith("/proc") ||
    lower.endsWith("/sys") ||
    lower.endsWith("/dev")
  ) {
    throw new PathEscape(userPath);
  }

  return candidate;
}

export function getDefaultWorkspaceRoot(): string {
  return DEFAULT_ROOT;
}

export function workspaceRootForProvider(name: ComputerProviderName): string {
  switch (name) {
    case "docker-dev":
      return "/workspace";
    case "runloop":
      return "/home/user/flok";
    case "fake":
      return DEFAULT_ROOT;
  }
}

function stripTrailingSlash(resolved: string): string {
  if (resolved.length > 1 && resolved.endsWith("/")) {
    return resolved.slice(0, -1);
  }
  return resolved;
}

function hasDotDotSegment(userPath: string): boolean {
  return userPath.split("/").includes("..");
}

function hasForbiddenSegment(userPath: string): boolean {
  return userPath.split("/").some((segment) => {
    const lower = segment.toLowerCase();
    return lower === "proc" || lower === "sys" || lower === "dev";
  });
}

function matchesAliasPrefix(absolute: string, prefix: string): boolean {
  return absolute === prefix || absolute.startsWith(`${prefix}/`);
}

/**
 * Map Bot-facing aliases onto the active provider root, then jail.
 * Rejects NUL, empty, and `..` segments before rewrite.
 */
export function canonicalizeWorkspacePath(
  userPath: string,
  providerRoot: string,
): string {
  if (typeof userPath !== "string" || userPath.length === 0) {
    throw new PathEscape(userPath ?? "");
  }
  if (
    userPath.includes("\0") ||
    hasDotDotSegment(userPath) ||
    hasForbiddenSegment(userPath)
  ) {
    throw new PathEscape(userPath);
  }

  const normalizedRoot = stripTrailingSlash(pathPosix.normalize(providerRoot));
  let candidate: string;
  if (userPath.startsWith("/")) {
    const absolute = stripTrailingSlash(pathPosix.normalize(userPath));
    const alias = WORKSPACE_ALIAS_PREFIXES.find((prefix) =>
      matchesAliasPrefix(absolute, prefix),
    );
    if (alias) {
      const rest = absolute.slice(alias.length);
      candidate = pathPosix.normalize(`${normalizedRoot}${rest}`);
    } else if (matchesAliasPrefix(absolute, normalizedRoot)) {
      candidate = absolute;
    } else {
      throw new PathEscape(userPath);
    }
  } else {
    candidate = pathPosix.normalize(pathPosix.join(normalizedRoot, userPath));
  }

  return assertInsideRoot(stripTrailingSlash(candidate), normalizedRoot);
}
