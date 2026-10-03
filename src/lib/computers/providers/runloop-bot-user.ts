/**
 * Unprivileged bot identity for computer_exec / computer_fs.
 *
 * Control plane (DnD, ensure, CDP helpers, screenshots) stays root.
 * Graphical stack stays flok-ui. Bot commands default to user `flok`.
 * No passwordless sudo. Helpers live in /var/lib/flok (root 0700), not the
 * customer workspace.
 *
 * Guest scripts in this file are string constants — never Function.toString().
 */

import { posix as pathPosix } from "node:path";
import { RUNLOOP_WORKSPACE_ROOT } from "./runloop-client.js";

/** Bot-facing unprivileged user. Distinct from flok-ui (Chrome / X). */
export const FLOK_BOT_USER = "flok";
export const FLOK_BOT_UID = 1501;
export const FLOK_BOT_HOME = RUNLOOP_WORKSPACE_ROOT;
export const FLOK_BOT_SHELL = "/bin/bash";
export const FLOK_BOT_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/**
 * Root-owned control-plane helpers. Mode 0700 so the bot user cannot list,
 * read, write, or delete them. Not under the workspace jail.
 */
export const CONTROL_PLANE_DIR = "/var/lib/flok";
export const CONTROL_PLANE_EXECVP_PATH = `${CONTROL_PLANE_DIR}/execvp.py`;
export const CONTROL_PLANE_ENSURE_PATH = `${CONTROL_PLANE_DIR}/ensure-interactive.sh`;
export const CONTROL_PLANE_BOT_USER_PATH = `${CONTROL_PLANE_DIR}/ensure-bot-user.sh`;
export const CONTROL_PLANE_CDP_AX_PATH = `${CONTROL_PLANE_DIR}/cdp-ax.mjs`;
export const CONTROL_PLANE_CDP_NAV_PATH = `${CONTROL_PLANE_DIR}/cdp-nav.mjs`;
export const CONTROL_PLANE_CDP_RUNTIME_DIR = "/run/flok-cdp";

/** Leftover workspace helper dir from computers created before this change. */
export const LEGACY_WORKSPACE_HELPER_DIR = `${RUNLOOP_WORKSPACE_ROOT}/.flok`;

/** flok-ui Chrome profile and screenshot dir. Not a customer file view. */
export const BOT_BROWSER_DIR = `${RUNLOOP_WORKSPACE_ROOT}/.browser`;

export const BOT_FORCED_ENV_KEYS = [
  "HOME",
  "USER",
  "LOGNAME",
  "PATH",
  "SHELL",
] as const;

export const BOT_DEFAULT_ENV: Record<(typeof BOT_FORCED_ENV_KEYS)[number], string> = {
  HOME: FLOK_BOT_HOME,
  USER: FLOK_BOT_USER,
  LOGNAME: FLOK_BOT_USER,
  PATH: FLOK_BOT_PATH,
  SHELL: FLOK_BOT_SHELL,
};

/** Prefix argv so a Devbox-root exec drops to `flok`. No shell concatenation. */
export function argvAsBotUser(argv: string[]): string[] {
  return [
    "runuser",
    "-u",
    FLOK_BOT_USER,
    "--",
    "env",
    `HOME=${FLOK_BOT_HOME}`,
    `USER=${FLOK_BOT_USER}`,
    `LOGNAME=${FLOK_BOT_USER}`,
    `PATH=${FLOK_BOT_PATH}`,
    `SHELL=${FLOK_BOT_SHELL}`,
    ...argv,
  ];
}

export function applyBotUserToExec(request: {
  argv: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
}): {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
} {
  const env: Record<string, string> = { ...(request.env ?? {}) };
  for (const key of BOT_FORCED_ENV_KEYS) {
    env[key] = BOT_DEFAULT_ENV[key];
  }
  return {
    argv: argvAsBotUser(request.argv),
    cwd: request.cwd,
    env,
    timeoutMs: request.timeoutMs,
  };
}

export function isReservedControlPlanePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  const normalized = pathPosix.normalize(path);
  if (normalized === CONTROL_PLANE_DIR || normalized.startsWith(`${CONTROL_PLANE_DIR}/`)) {
    return true;
  }
  if (
    normalized === CONTROL_PLANE_CDP_RUNTIME_DIR ||
    normalized.startsWith(`${CONTROL_PLANE_CDP_RUNTIME_DIR}/`)
  ) {
    return true;
  }
  if (
    normalized === LEGACY_WORKSPACE_HELPER_DIR ||
    normalized.startsWith(`${LEGACY_WORKSPACE_HELPER_DIR}/`)
  ) {
    return true;
  }
  if (normalized === BOT_BROWSER_DIR || normalized.startsWith(`${BOT_BROWSER_DIR}/`)) {
    return true;
  }
  const parts = normalized.split("/");
  return parts.includes(".flok") || parts.includes(".browser");
}

/** Hide leftover `.flok` and the flok-ui browser profile from a workspace listing. */
export function filterBotVisibleListing(dir: string, names: string[]): string[] {
  const normalized = pathPosix.normalize(dir);
  if (normalized === RUNLOOP_WORKSPACE_ROOT) {
    return names.filter((name) => name !== ".flok" && name !== ".browser");
  }
  return names.filter((name) => !isReservedControlPlanePath(pathPosix.join(normalized, name)));
}

export function reservedFilesystemError(path: string): { ok: false; errorCode: "PERMISSION_DENIED" } {
  void path;
  return { ok: false, errorCode: "PERMISSION_DENIED" };
}

export function unwrapBotArgv(argv: string[]): {
  user: string | null;
  argv: string[];
  env: Record<string, string>;
} {
  if (argv[0] !== "runuser" || argv[1] !== "-u" || typeof argv[2] !== "string") {
    return { user: null, argv, env: {} };
  }
  const user = argv[2];
  const afterUser = argv[3] === "--" ? argv.slice(4) : argv.slice(3);
  if (afterUser[0] !== "env") {
    return { user, argv: afterUser, env: {} };
  }
  const env: Record<string, string> = {};
  let i = 1;
  while (i < afterUser.length) {
    const item = afterUser[i];
    if (item === undefined || !item.includes("=") || item.startsWith("-")) break;
    const eq = item.indexOf("=");
    env[item.slice(0, eq)] = item.slice(eq + 1);
    i += 1;
  }
  return { user, argv: afterUser.slice(i), env };
}

export function argvTouchesReserved(argv: string[]): boolean {
  return argv.some((arg) => {
    if (typeof arg !== "string" || arg.length === 0) return false;
    if (arg.includes("\0")) return true;
    if (arg.includes(CONTROL_PLANE_DIR) || arg.includes(CONTROL_PLANE_CDP_RUNTIME_DIR)) {
      return true;
    }
    if (arg.includes("/.flok") || arg.endsWith(".flok") || arg.includes(".flok/")) {
      return true;
    }
    if (arg.includes("/.browser") || arg.endsWith(".browser") || arg.includes(".browser/")) {
      return true;
    }
    if (arg.startsWith("/") && isReservedControlPlanePath(arg.replace(/[*?[\]]/g, ""))) {
      return true;
    }
    return false;
  });
}

/**
 * Idempotent guest script. Creates `flok` on older computers, locks helpers
 * under /var/lib/flok, strips leftover workspace `.flok`, and never grants sudo.
 * String constant — do not rebuild the blueprint for this change.
 */
export const ENSURE_BOT_USER_SH = `#!/bin/bash
set -euo pipefail
BOT_USER="\${FLOK_BOT_USER:-flok}"
BOT_UID="\${FLOK_BOT_UID:-1501}"
BOT_HOME="\${FLOK_BOT_HOME:-/home/user/flok}"
CTRL="\${FLOK_CONTROL_PLANE_DIR:-/var/lib/flok}"
WS="/home/user/flok"
UI_USER="\${FLOK_UI_USER:-flok-ui}"

if ! command -v useradd >/dev/null 2>&1; then
  echo "unprivileged bot user missing: useradd is not available" >&2
  exit 1
fi
if ! command -v runuser >/dev/null 2>&1; then
  echo "unprivileged bot user missing: runuser is not available" >&2
  exit 1
fi

if ! getent group "$BOT_USER" >/dev/null 2>&1; then
  if getent group "$BOT_UID" >/dev/null 2>&1; then
    echo "cannot create group $BOT_USER: gid $BOT_UID already in use" >&2
    exit 1
  fi
  groupadd -g "$BOT_UID" "$BOT_USER"
fi

if ! id -u "$BOT_USER" >/dev/null 2>&1; then
  if getent passwd "$BOT_UID" >/dev/null 2>&1; then
    echo "cannot create user $BOT_USER: uid $BOT_UID already in use" >&2
    exit 1
  fi
  if ! useradd -M -u "$BOT_UID" -g "$BOT_USER" -d "$BOT_HOME" -s /bin/bash "$BOT_USER"; then
    echo "could not create unprivileged bot user '$BOT_USER' on this computer" >&2
    exit 1
  fi
fi

if getent group sudo >/dev/null 2>&1 && id -nG "$BOT_USER" 2>/dev/null | grep -qw sudo; then
  gpasswd -d "$BOT_USER" sudo || true
fi
rm -f /etc/sudoers.d/flok /etc/sudoers.d/90-flok /etc/sudoers.d/"$BOT_USER" || true
if [ -e /etc/sudoers.d/flok ] || [ -e /etc/sudoers.d/"$BOT_USER" ]; then
  echo "refusing leftover sudoers drop-in for $BOT_USER" >&2
  exit 1
fi

mkdir -p "$CTRL"
chown -h root:root "$CTRL"
chmod 0700 "$CTRL"

if [ -d "$WS" ] && [ ! -L "$WS" ]; then
  chown -h "$BOT_USER:$BOT_USER" "$WS" || true
  chmod 775 "$WS" || true
  # -hP: never dereference; -P with -R does not walk through symlinks.
  find "$WS" -mindepth 1 -maxdepth 1 ! -name .browser ! -name .flok -exec chown -hP -R "$BOT_USER:$BOT_USER" {} + || true
fi
if [ -L "$WS/.browser" ]; then
  echo "refusing symlink $WS/.browser" >&2
elif [ -d "$WS/.browser" ]; then
  chown -hP -R "$UI_USER:$UI_USER" "$WS/.browser" || true
  chmod 700 "$WS/.browser" || true
fi

# Helpers must not appear in the customer workspace file view.
rm -rf "$WS/.flok"

echo "ok bot-user=$BOT_USER uid=$(id -u "$BOT_USER") home=$BOT_HOME ctrl=$CTRL nosudo=1"
`;
