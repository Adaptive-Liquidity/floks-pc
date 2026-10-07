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

import { randomUUID } from "node:crypto";
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

/** Per-call write spec. Never a shared `/var/lib/flok/fs-spec.json`. */
export const CONTROL_PLANE_FS_SPEC_RE =
  /^\/var\/lib\/flok\/fs-spec-[0-9a-f-]{36}\.json$/;

export function uniqueControlPlaneFsSpecPath(): string {
  return `${CONTROL_PLANE_DIR}/fs-spec-${randomUUID()}.json`;
}

/** Leftover workspace helper dir from computers created before this change. */
export const LEGACY_WORKSPACE_HELPER_DIR = `${RUNLOOP_WORKSPACE_ROOT}/.flok`;

/**
 * Leftover workspace Chrome dir from computers created before the profile
 * moved under `/home/flok-ui`. Still reserved. Never adopted as --user-data-dir.
 */
export const BOT_BROWSER_DIR = `${RUNLOOP_WORKSPACE_ROOT}/.browser`;

/** flok-ui home. Root-owned 0755 so flok-ui cannot rename `.flok-browser`. */
export const UI_HOME_DIR = "/home/flok-ui";

/**
 * Chrome profile + screenshots. flok-ui 0700, created by root with a
 * `.flok-root` marker. Outside the flok-owned workspace.
 */
export const UI_BROWSER_DIR = `${UI_HOME_DIR}/.flok-browser`;
export const UI_BROWSER_MARKER = ".flok-root";

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

function isReservedWorkspaceEntry(name: string): boolean {
  return (
    name === ".flok" ||
    name === ".browser" ||
    name.startsWith(".browser.quarantine-") ||
    name === ".flok-browser" ||
    name.startsWith(".flok-browser.")
  );
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
  if (normalized === UI_HOME_DIR || normalized.startsWith(`${UI_HOME_DIR}/`)) {
    return true;
  }
  if (normalized === BOT_BROWSER_DIR || normalized.startsWith(`${BOT_BROWSER_DIR}/`)) {
    return true;
  }
  const parts = normalized.split("/");
  return parts.some((part) => isReservedWorkspaceEntry(part));
}

/** Hide leftover `.flok` / `.browser` / quarantine names from a workspace listing. */
export function filterBotVisibleListing(dir: string, names: string[]): string[] {
  const normalized = pathPosix.normalize(dir);
  if (normalized === RUNLOOP_WORKSPACE_ROOT) {
    return names.filter((name) => !isReservedWorkspaceEntry(name));
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
    if (
      arg.includes("/.flok-browser") ||
      arg.endsWith(".flok-browser") ||
      arg.includes(".flok-browser/") ||
      arg.includes(UI_HOME_DIR)
    ) {
      return true;
    }
    if (arg.startsWith("/") && isReservedControlPlanePath(arg.replace(/[*?[\]]/g, ""))) {
      return true;
    }
    return false;
  });
}

/**
 * Root-only guest script. Creates `/home/flok-ui/.flok-browser` via fd
 * (O_DIRECTORY|O_NOFOLLOW + fchown/fchmod). Never adopts a dir root did not
 * create — quarantine to `.flok-browser.quarantine-<ts>` / leftover workspace
 * `.browser.quarantine-<ts>`. Sticky 1775 does not protect a flok-owned
 * workspace name; Chrome lives outside that tree.
 */
export const ENSURE_UI_BROWSER_PY = [
  "import os,stat,sys,time",
  "UI_UID=int(os.environ.get('FLOK_UI_UID','1500'))",
  "UI_HOME=os.environ.get('FLOK_UI_HOME','/home/flok-ui')",
  "WS=os.environ.get('FLOK_BOT_HOME','/home/user/flok')",
  "BROWSER_NAME='.flok-browser'",
  "MARKER='.flok-root'",
  "WS_BROWSER='.browser'",
  "UI_SUBDIRS=('.config','.cache','.pki','.local')",
  "NOFOLLOW=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOCTTY",
  "def die(msg):",
  "    sys.stderr.write(msg+'\\n'); raise SystemExit(1)",
  "def open_dir(path):",
  "    try: fd=os.open(path, NOFOLLOW)",
  "    except OSError: die('permission denied: cannot open '+path)",
  "    st=os.fstat(fd)",
  "    if not stat.S_ISDIR(st.st_mode):",
  "        os.close(fd); die('not a directory: '+path)",
  "    return fd",
  "def fown(fd, uid, gid, mode):",
  "    os.fchown(fd, uid, gid); os.fchmod(fd, mode)",
  "def has_marker(dirfd):",
  "    try: mfd=os.open(MARKER, os.O_RDONLY|os.O_NOFOLLOW|os.O_NOCTTY, dir_fd=dirfd)",
  "    except OSError: return False",
  "    try:",
  "        st=os.fstat(mfd)",
  "        return stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_uid==0",
  "    finally:",
  "        os.close(mfd)",
  "def write_marker(dirfd):",
  "    flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_NOCTTY",
  "    mfd=os.open(MARKER, flags, 0o600, dir_fd=dirfd)",
  "    try:",
  "        os.fchown(mfd, 0, 0); os.fchmod(mfd, 0o600)",
  "    finally:",
  "        os.close(mfd)",
  "def unique_quarantine(dirfd, prefix):",
  "    base='%s.quarantine-%d' % (prefix, int(time.time()))",
  "    name=base; n=0",
  "    while True:",
  "        try: os.stat(name, dir_fd=dirfd, follow_symlinks=False)",
  "        except FileNotFoundError: return name",
  "        n+=1; name='%s-%d' % (base, n)",
  "def ensure_child_dir(dirfd, name, uid, gid, mode):",
  "    try:",
  "        st=os.stat(name, dir_fd=dirfd, follow_symlinks=False)",
  "    except FileNotFoundError:",
  "        st=None",
  "    if st is not None and (stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode)):",
  "        os.rename(name, unique_quarantine(dirfd, name), src_dir_fd=dirfd, dst_dir_fd=dirfd)",
  "        st=None",
  "    if st is None:",
  "        os.mkdir(name, mode, dir_fd=dirfd)",
  "    cfd=os.open(name, NOFOLLOW, dir_fd=dirfd)",
  "    try: fown(cfd, uid, gid, mode)",
  "    finally: os.close(cfd)",
  "def kill_old_workspace_chrome():",
  "    needle='--user-data-dir=/home/user/flok/.browser'",
  "    self=os.getpid()",
  "    pids=[]",
  "    try: names=os.listdir('/proc')",
  "    except OSError: return",
  "    for name in names:",
  "        if not name.isdigit() or int(name)==self: continue",
  "        try:",
  "            if os.stat('/proc/'+name).st_uid!=UI_UID: continue",
  "            cmd=open('/proc/%s/cmdline'%name,'rb').read().replace(b'\\x00',b' ').decode('utf-8','replace')",
  "            if needle in cmd and 'google-chrome' in cmd: pids.append(int(name))",
  "        except OSError: continue",
  "    for pid in pids:",
  "        try: os.kill(pid, 15)",
  "        except OSError: pass",
  "    deadline=time.time()+3",
  "    while time.time()<deadline and pids:",
  "        live=[]",
  "        for pid in pids:",
  "            try:",
  "                os.kill(pid, 0); live.append(pid)",
  "            except OSError: pass",
  "        if not live: return",
  "        pids=live; time.sleep(0.1)",
  "    for pid in pids:",
  "        try: os.kill(pid, 9)",
  "        except OSError: pass",
  "    deadline=time.time()+1",
  "    while time.time()<deadline and pids:",
  "        live=[]",
  "        for pid in pids:",
  "            try:",
  "                os.kill(pid, 0); live.append(pid)",
  "            except OSError: pass",
  "        if not live: return",
  "        pids=live; time.sleep(0.05)",
  "def ensure_dir(path, uid, gid, mode):",
  "    parent=os.path.dirname(path); name=os.path.basename(path)",
  "    try:",
  "        st=os.lstat(path)",
  "    except FileNotFoundError:",
  "        st=None",
  "    if st is not None:",
  "        if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):",
  "            die('refusing non-directory '+path)",
  "        fd=open_dir(path)",
  "        try: fown(fd, uid, gid, mode)",
  "        finally: os.close(fd)",
  "        return",
  "    pfd=open_dir(parent)",
  "    try:",
  "        try: os.mkdir(name, mode, dir_fd=pfd)",
  "        except FileExistsError: pass",
  "        fd=os.open(name, NOFOLLOW, dir_fd=pfd)",
  "        try: fown(fd, uid, gid, mode)",
  "        finally: os.close(fd)",
  "    finally:",
  "        os.close(pfd)",
  "ensure_dir(UI_HOME, 0, 0, 0o755)",
  "home_fd=open_dir(UI_HOME)",
  "try:",
  "    fown(home_fd, 0, 0, 0o755)",
  "    for sub in UI_SUBDIRS: ensure_child_dir(home_fd, sub, UI_UID, UI_UID, 0o700)",
  "    try: st=os.stat(BROWSER_NAME, dir_fd=home_fd, follow_symlinks=False)",
  "    except FileNotFoundError: st=None",
  "    keep=False",
  "    if st is not None and (not stat.S_ISLNK(st.st_mode)) and stat.S_ISDIR(st.st_mode):",
  "        bfd=os.open(BROWSER_NAME, NOFOLLOW, dir_fd=home_fd)",
  "        try:",
  "            if has_marker(bfd):",
  "                keep=True",
  "                fown(bfd, UI_UID, UI_UID, 0o700)",
  "                ensure_child_dir(bfd, 'profile', UI_UID, UI_UID, 0o700)",
  "        finally:",
  "            os.close(bfd)",
  "    if not keep:",
  "        if st is not None:",
  "            q=unique_quarantine(home_fd, BROWSER_NAME)",
  "            os.rename(BROWSER_NAME, q, src_dir_fd=home_fd, dst_dir_fd=home_fd)",
  "            sys.stderr.write('quarantined untrusted %s/%s -> %s\\n' % (UI_HOME, BROWSER_NAME, q))",
  "        os.mkdir(BROWSER_NAME, 0o700, dir_fd=home_fd)",
  "        bfd=os.open(BROWSER_NAME, NOFOLLOW, dir_fd=home_fd)",
  "        try:",
  "            fown(bfd, UI_UID, UI_UID, 0o700)",
  "            write_marker(bfd)",
  "            ensure_child_dir(bfd, 'profile', UI_UID, UI_UID, 0o700)",
  "        finally:",
  "            os.close(bfd)",
  "finally:",
  "    os.close(home_fd)",
  "kill_old_workspace_chrome()",
  "try: wst=os.lstat(os.path.join(WS, WS_BROWSER))",
  "except FileNotFoundError: wst=None",
  "if wst is not None:",
  "    wsfd=open_dir(WS)",
  "    try:",
  "        q=unique_quarantine(wsfd, WS_BROWSER)",
  "        os.rename(WS_BROWSER, q, src_dir_fd=wsfd, dst_dir_fd=wsfd)",
  "        sys.stderr.write('quarantined leftover workspace .browser -> %s\\n' % q)",
  "    finally:",
  "        os.close(wsfd)",
].join("\n");

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
  # Sticky does not protect names the directory owner can rename. Chrome
  # lives under /home/flok-ui/.flok-browser (root-owned 0755 parent).
  chmod 1775 "$WS" || true
  # -hP: never dereference; -P with -R does not walk through symlinks.
  find "$WS" -mindepth 1 -maxdepth 1 ! -name .browser ! -name .flok ! -name '.browser.quarantine-*' -exec chown -hP -R "$BOT_USER:$BOT_USER" {} + || true
fi

export FLOK_UI_HOME="\${FLOK_UI_HOME:-/home/flok-ui}"
export FLOK_UI_UID="\${FLOK_UI_UID:-1500}"
export FLOK_BOT_HOME="$BOT_HOME"
python3 - <<'PY'
${ENSURE_UI_BROWSER_PY}
PY

# Helpers must not appear in the customer workspace file view.
rm -rf "$WS/.flok"

echo "ok bot-user=$BOT_USER uid=$(id -u "$BOT_USER") home=$BOT_HOME ctrl=$CTRL nosudo=1"
`;
