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

  const normalizedRoot = pathPosix.normalize(root);
  const rootWithSep = normalizedRoot.endsWith("/")
    ? normalizedRoot
    : normalizedRoot + "/";

  // Relative paths join under root. Absolute paths must already be inside root.
  const candidate = userPath.startsWith("/")
    ? pathPosix.normalize(userPath)
    : pathPosix.normalize(pathPosix.join(normalizedRoot, userPath));

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
