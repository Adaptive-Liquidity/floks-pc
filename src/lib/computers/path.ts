/**
 * Path jail helpers.
 * Every filesystem operation must run user paths through assertInsideRoot.
 */

import { PathEscape } from "./errors.js";
import { posix as pathPosix } from "node:path";

const DEFAULT_ROOT = "/home/flok";

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

  // Normalize separators and resolve relative to root
  const normalizedRoot = pathPosix.normalize(root);
  // If userPath is absolute, treat it as relative to / for joining under root
  const candidate = userPath.startsWith("/")
    ? pathPosix.join(normalizedRoot, userPath.slice(1))
    : pathPosix.join(normalizedRoot, userPath);

  const resolved = pathPosix.normalize(candidate);

  // Must still start with the root (with trailing slash protection)
  const rootWithSep = normalizedRoot.endsWith("/")
    ? normalizedRoot
    : normalizedRoot + "/";

  if (resolved !== normalizedRoot && !resolved.startsWith(rootWithSep)) {
    throw new PathEscape(userPath);
  }

  // Reject device / proc / sys style paths even if somehow under root
  const lower = resolved.toLowerCase();
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

  return resolved;
}

export function getDefaultWorkspaceRoot(): string {
  return DEFAULT_ROOT;
}
