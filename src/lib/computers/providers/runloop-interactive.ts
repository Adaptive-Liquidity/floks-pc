/**
 * C3B interactive-computer helpers.
 * Pure validation + constants. No network.
 *
 * Suspend preserves disk, not RAM. Graphical daemons and Chromium must be
 * restarted after provision, restore, and resume via ensureInteractiveStack().
 */

import { randomUUID } from "node:crypto";
import { posix as pathPosix } from "node:path";
import type { Action } from "../types.js";
import { RUNLOOP_WORKSPACE_ROOT } from "./runloop-client.js";
import { CDP_DEBUG_ADDRESS, CDP_DEBUG_PORT } from "./runloop-cdp.js";

export {
  CDP_AX_HELPER_DEADLINE_MS,
  CDP_AX_HELPER_JS,
  CDP_DEBUG_ADDRESS,
  CDP_DEBUG_PORT,
  CDP_HELPER_PATH,
  CDP_NODE_BIN,
  CdpAxDumpSchema,
  logCdpAxObserve,
  mapCdpAxDump,
  parseCdpAxHelperStdout,
} from "./runloop-cdp.js";

export const FLOK_DISPLAY = ":99";
export const DISPLAY_WIDTH = 1440;
export const DISPLAY_HEIGHT = 900;
export const DISPLAY_DEPTH = 24;
export const BROWSER_PROFILE_DIR = `${RUNLOOP_WORKSPACE_ROOT}/.browser/profile`;
export const INTERACTIVE_DIR = `${RUNLOOP_WORKSPACE_ROOT}/.flok`;
export const FIXTURE_PATH = `${INTERACTIVE_DIR}/fixture.html`;
/** Unique PNG path under the flok-ui-writable browser dir (not root-locked .flok). */
export const OBS_SHOT_DIR = `${RUNLOOP_WORKSPACE_ROOT}/.browser`;
export function uniqueObsShotPath(): string {
  return `${OBS_SHOT_DIR}/obs-${randomUUID()}.png`;
}
export const ENSURE_SCRIPT_PATH = `${INTERACTIVE_DIR}/ensure-interactive.sh`;
export const LOCAL_NOVNC_URL = "http://127.0.0.1:6080/";
export const MAX_TYPE_CHARS = 2000;
export const MAX_WAIT_MS = 10_000;
export const DEFAULT_INTERACTIVE_BLUEPRINT = "flok-runloop-interactive";
/** Non-root user that owns Xvfb/Openbox/Chrome/x11vnc/noVNC. DnD stays root. */
export const FLOK_UI_USER = "flok-ui";
export const FLOK_UI_HOME = "/home/flok-ui";
export const FLOK_UI_UID = 1500;
export const FLOK_UI_XDG_RUNTIME = `/run/user/${FLOK_UI_UID}`;

export const ALLOWED_APPS = new Set(["browser", "chromium", "chrome", "google-chrome"]);

export const ALLOWED_KEYS = new Set([
  "Return",
  "Tab",
  "Escape",
  "BackSpace",
  "Delete",
  "space",
  "Up",
  "Down",
  "Left",
  "Right",
  "Home",
  "End",
  "F5",
  "ctrl+l",
  "ctrl+t",
  "ctrl+w",
  "ctrl+r",
  "ctrl+a",
  "ctrl+c",
  "ctrl+v",
]);

const KEY_RE = /^[A-Za-z0-9]$/;

export function isAllowedKey(key: string): boolean {
  return ALLOWED_KEYS.has(key) || KEY_RE.test(key);
}

export function validateOpenUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "malformed URL";
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") return null;
  if (parsed.protocol === "file:") {
    const path = pathPosix.normalize(decodeURIComponent(parsed.pathname));
    if (path === RUNLOOP_WORKSPACE_ROOT || path.startsWith(`${RUNLOOP_WORKSPACE_ROOT}/`)) {
      return null;
    }
    return "file URL escapes workspace jail";
  }
  return `unsupported URL scheme: ${parsed.protocol}`;
}

/** Returns an error string or null if the action is acceptable. */
export function validateAction(action: Action): string | null {
  switch (action.type) {
    case "click_element":
      return "click_element unsupported until accessibility addressing exists";
    case "click_coordinates": {
      if (typeof action.x !== "number" || typeof action.y !== "number") {
        return "click_coordinates requires x and y";
      }
      if (!Number.isInteger(action.x) || !Number.isInteger(action.y)) {
        return "coordinates must be integers";
      }
      if (action.x < 0 || action.y < 0 || action.x >= DISPLAY_WIDTH || action.y >= DISPLAY_HEIGHT) {
        return `coordinates out of bounds (0..${DISPLAY_WIDTH - 1}, 0..${DISPLAY_HEIGHT - 1})`;
      }
      return null;
    }
    case "type": {
      if (typeof action.text !== "string" || action.text.length === 0) {
        return "type requires text";
      }
      if (action.text.length > MAX_TYPE_CHARS) {
        return `type text exceeds ${MAX_TYPE_CHARS} characters`;
      }
      if (action.text.includes("\0")) return "type text contains NUL";
      return null;
    }
    case "key": {
      if (typeof action.key !== "string" || action.key.length === 0) return "key required";
      if (!isAllowedKey(action.key)) return `key not allowed: ${action.key}`;
      return null;
    }
    case "scroll": {
      if (action.x !== undefined && action.x !== 0) {
        return "horizontal scroll unsupported";
      }
      if (!Number.isInteger(action.y) || action.y === 0) {
        return "scroll requires non-zero integer y delta";
      }
      return null;
    }
    case "open_url": {
      if (typeof action.url !== "string" || action.url.length === 0) return "open_url requires url";
      return validateOpenUrl(action.url);
    }
    case "launch_application": {
      const app = action.application ?? "";
      if (!ALLOWED_APPS.has(app)) return `application not in allowlist: ${app || "(empty)"}`;
      return null;
    }
    case "wait": {
      const ms = action.durationMs ?? 0;
      if (!Number.isInteger(ms) || ms <= 0) return "wait requires positive durationMs";
      if (ms > MAX_WAIT_MS) return `wait exceeds ${MAX_WAIT_MS}ms`;
      return null;
    }
    default:
      return "unsupported action";
  }
}

/** Read IHDR width/height from a PNG buffer. Null if not a PNG. */
export function pngDimensions(png: Buffer): { width: number; height: number } | null {
  if (png.length < 24) return null;
  if (png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export type BlueprintBuildPhase = "pending" | "success" | "failure";

/**
 * Runloop Blueprint `status` is queued | provisioning | building | failed | build_complete.
 * Docs also mention build_failed as a failure_reason (and sometimes as a status alias).
 */
export function classifyBlueprintBuildStatus(status: string): BlueprintBuildPhase {
  switch (status) {
    case "queued":
    case "provisioning":
    case "building":
      return "pending";
    case "build_complete":
      return "success";
    case "failed":
    case "build_failed":
      return "failure";
    default:
      return "failure";
  }
}

/** Prefix argv so a Devbox-root exec drops to flok-ui. No shell concatenation. */
export function argvAsUiUser(argv: string[]): string[] {
  return [
    "runuser",
    "-u",
    FLOK_UI_USER,
    "--",
    "env",
    `DISPLAY=${FLOK_DISPLAY}`,
    `HOME=${FLOK_UI_HOME}`,
    `XDG_RUNTIME_DIR=${FLOK_UI_XDG_RUNTIME}`,
    ...argv,
  ];
}

/** Chrome argv as flok-ui. Sandbox preserved: never add --no-sandbox. */
export function chromeLaunchArgv(url: string): string[] {
  return argvAsUiUser([
    "google-chrome-stable",
    `--user-data-dir=${BROWSER_PROFILE_DIR}`,
    `--window-size=${DISPLAY_WIDTH},${DISPLAY_HEIGHT}`,
    "--window-position=0,0",
    `--app=${url}`,
    "--no-first-run",
    "--disable-sync",
    `--remote-debugging-port=${CDP_DEBUG_PORT}`,
    `--remote-debugging-address=${CDP_DEBUG_ADDRESS}`,
    // Node's WebSocket sends no Origin; Chrome 128+ closes the upgrade otherwise.
    // Port is still 127.0.0.1-only — this does not publish CDP off-box.
    "--remote-allow-origins=*",
  ]);
}

/** Guest-local Chrome startup log. Not an audit artifact; truncated in diagnostics. */
export const CHROME_LOG_PATH = "/tmp/flok-chrome.log";
export const CHROME_HOME_FALLBACK_DIR = `${FLOK_UI_HOME}/.config/google-chrome`;
export const CHROME_READY_TIMEOUT_MS = 20_000;
export const CHROME_READY_POLL_MS = 500;
const CHROME_LOG_TAIL_CHARS = 4096;
const PROFILE_TEST_MARKERS = new Set(["c3b-marker", "last-url", "launched"]);

export type ChromeReadyClass =
  | "ready"
  | "pending"
  | "never_started"
  | "started_then_exited"
  | "sandbox_disabled"
  | "permissions_failure"
  | "sandbox_failure"
  | "display_failure"
  | "profile_redirected"
  | "readiness_timeout";

export interface ChromeReadyEvidence {
  chromeCmdlines: string[];
  profileEntries: string[];
  profileEntriesUi: string[];
  profileUid: number | null;
  profileGid: number | null;
  profileMode: string | null;
  profileWritableByUi: boolean;
  browserDirMode: string | null;
  workspaceMode: string | null;
  sandboxPath: string | null;
  sandboxMode: string | null;
  sandboxNosuid: boolean | null;
  xvfbAlive: boolean;
  openboxAlive: boolean;
  display: string;
  visibleWindows: string[];
  homeFallbackEntries: string[];
  chromeLogTail: string;
  logHasSandboxError: boolean;
  logHasChromeOutput: boolean;
  unprivilegedUserns: string | null;
}

export interface ChromeReadyResult {
  status: ChromeReadyClass;
  ready: boolean;
  /** Stop polling: success or a classified failure. */
  terminal: boolean;
  message: string;
}

export function chromeHasUserDataDir(cmdline: string): boolean {
  return cmdline.includes(`--user-data-dir=${BROWSER_PROFILE_DIR}`);
}

/** True if the cmdline disables Chrome's sandbox. Never treat this as ready. */
export function chromeHasNoSandbox(cmdline: string): boolean {
  return /(?:^|\s)--no-sandbox(?:\s|$)/.test(cmdline);
}

export function chromeHasDisableSetuidSandbox(cmdline: string): boolean {
  return /(?:^|\s)--disable-setuid-sandbox(?:\s|$)/.test(cmdline);
}

export function chromeSandboxDisabled(cmdline: string): boolean {
  return chromeHasNoSandbox(cmdline) || chromeHasDisableSetuidSandbox(cmdline);
}

export function chromeProfileHasBrowserState(entries: string[]): boolean {
  return entries.some((name) => !PROFILE_TEST_MARKERS.has(name) && !name.startsWith("."));
}

export function sanitizeChromeLog(raw: string): string {
  const filtered = raw
    .split("\n")
    .filter(
      (line) =>
        !/api[_-]?key|bearer\s+\S+|set-cookie|cookie:|runloop_api|authorization:/i.test(line),
    )
    .join("\n");
  return filtered.length <= CHROME_LOG_TAIL_CHARS
    ? filtered
    : filtered.slice(filtered.length - CHROME_LOG_TAIL_CHARS);
}

function ourChromeCmdlines(cmdlines: string[]): string[] {
  return cmdlines.filter(
    (c) => /google-chrome/.test(c) || chromeHasUserDataDir(c),
  );
}

export function classifyChromeReadiness(
  evidence: ChromeReadyEvidence,
  opts?: { timedOut?: boolean; requireProfile?: boolean },
): ChromeReadyResult {
  const timedOut = opts?.timedOut === true;
  const requireProfile = opts?.requireProfile === true;
  const ours = ourChromeCmdlines(evidence.chromeCmdlines);
  const alive = ours.length > 0;
  const noSandbox = ours.some(chromeSandboxDisabled);
  const userData = ours.some(chromeHasUserDataDir);
  const profileState =
    chromeProfileHasBrowserState(evidence.profileEntries) ||
    chromeProfileHasBrowserState(evidence.profileEntriesUi);
  const windowUp = evidence.visibleWindows.length > 0;
  const fallback = evidence.homeFallbackEntries.length > 0;

  if (noSandbox) {
    return {
      status: "sandbox_disabled",
      ready: false,
      terminal: true,
      message: "Chrome cmdline contains --no-sandbox or --disable-setuid-sandbox; refuse to continue",
    };
  }
  if (alive && !evidence.profileWritableByUi) {
    return {
      status: "permissions_failure",
      ready: false,
      terminal: true,
      message: `profile not writable by ${FLOK_UI_USER} (uid ${FLOK_UI_UID} mode=${evidence.profileMode} uid=${evidence.profileUid})`,
    };
  }
  if (alive && !evidence.xvfbAlive) {
    return {
      status: "display_failure",
      ready: false,
      terminal: true,
      message: `Xvfb not running on ${evidence.display}`,
    };
  }
  if (alive && fallback && !profileState && timedOut) {
    return {
      status: "profile_redirected",
      ready: false,
      terminal: true,
      message: `Chrome wrote ${CHROME_HOME_FALLBACK_DIR} instead of ${BROWSER_PROFILE_DIR}`,
    };
  }
  if (alive && userData && profileState) {
    return {
      status: "ready",
      ready: true,
      terminal: true,
      message: "Chrome alive with initialized profile",
    };
  }
  if (alive && userData && windowUp && !requireProfile) {
    return {
      status: "ready",
      ready: true,
      terminal: true,
      message: "Chrome alive with a visible window",
    };
  }
  if (alive && evidence.logHasSandboxError && timedOut) {
    return {
      status: "sandbox_failure",
      ready: false,
      terminal: true,
      message: "Chrome sandbox/namespace error in startup log; profile never initialized",
    };
  }
  if (!alive && timedOut) {
    if (evidence.logHasChromeOutput) {
      return {
        status: "started_then_exited",
        ready: false,
        terminal: true,
        message: "Chrome started then exited before becoming ready",
      };
    }
    return {
      status: "never_started",
      ready: false,
      terminal: true,
      message: "no flok-ui Chrome process and no Chrome log output",
    };
  }
  if (timedOut) {
    return {
      status: "readiness_timeout",
      ready: false,
      terminal: true,
      message: `Chrome still not ready after ${CHROME_READY_TIMEOUT_MS}ms (alive=${alive} userDataDir=${userData} profileState=${profileState} windows=${windowUp})`,
    };
  }
  return {
    status: "pending",
    ready: false,
    terminal: false,
    message: alive
      ? profileState
        ? "Chrome alive; waiting for window"
        : windowUp || requireProfile
          ? "Chrome alive; waiting for profile"
          : "Chrome alive; waiting for profile or window"
      : "waiting for Chrome process",
  };
}

export async function pollUntilChromeReady(
  probe: () => Promise<ChromeReadyEvidence>,
  opts?: {
    timeoutMs?: number;
    intervalMs?: number;
    requireProfile?: boolean;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<{ result: ChromeReadyResult; evidence: ChromeReadyEvidence }> {
  const timeoutMs = opts?.timeoutMs ?? CHROME_READY_TIMEOUT_MS;
  const intervalMs = opts?.intervalMs ?? CHROME_READY_POLL_MS;
  const requireProfile = opts?.requireProfile === true;
  const now = opts?.now ?? Date.now;
  const sleep =
    opts?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  let evidence = await probe();
  for (;;) {
    const timedOut = now() >= deadline;
    const result = classifyChromeReadiness(evidence, { timedOut, requireProfile });
    if (result.ready || result.terminal) return { result, evidence };
    await sleep(intervalMs);
    evidence = await probe();
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseChromeReadyEvidence(raw: string): ChromeReadyEvidence {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("chrome ready probe did not return an object");
  }
  const o = parsed as Record<string, unknown>;
  return {
    chromeCmdlines: asStringArray(o.chromeCmdlines),
    profileEntries: asStringArray(o.profileEntries),
    profileEntriesUi: asStringArray(o.profileEntriesUi),
    profileUid: asNullableNumber(o.profileUid),
    profileGid: asNullableNumber(o.profileGid),
    profileMode: asNullableString(o.profileMode),
    profileWritableByUi: asBoolean(o.profileWritableByUi),
    browserDirMode: asNullableString(o.browserDirMode),
    workspaceMode: asNullableString(o.workspaceMode),
    sandboxPath: asNullableString(o.sandboxPath),
    sandboxMode: asNullableString(o.sandboxMode),
    sandboxNosuid: typeof o.sandboxNosuid === "boolean" ? o.sandboxNosuid : null,
    xvfbAlive: asBoolean(o.xvfbAlive),
    openboxAlive: asBoolean(o.openboxAlive),
    display: typeof o.display === "string" ? o.display : FLOK_DISPLAY,
    visibleWindows: asStringArray(o.visibleWindows),
    homeFallbackEntries: asStringArray(o.homeFallbackEntries),
    chromeLogTail: sanitizeChromeLog(typeof o.chromeLogTail === "string" ? o.chromeLogTail : ""),
    logHasSandboxError: asBoolean(o.logHasSandboxError),
    logHasChromeOutput: asBoolean(o.logHasChromeOutput),
    unprivilegedUserns: asNullableString(o.unprivilegedUserns),
  };
}

export function formatChromeReadyFailure(
  result: ChromeReadyResult,
  evidence: ChromeReadyEvidence,
): string {
  const lines = [
    `chrome readiness: ${result.status}`,
    result.message,
    `display=${evidence.display} xvfb=${evidence.xvfbAlive} openbox=${evidence.openboxAlive}`,
    `profile mode=${evidence.profileMode} uid=${evidence.profileUid} gid=${evidence.profileGid} writableByUi=${evidence.profileWritableByUi}`,
    `workspace mode=${evidence.workspaceMode} browserDir mode=${evidence.browserDirMode}`,
    `sandbox path=${evidence.sandboxPath} mode=${evidence.sandboxMode} nosuid=${evidence.sandboxNosuid} userns_clone=${evidence.unprivilegedUserns}`,
    `profile entries: ${evidence.profileEntries.join(",") || "(none)"}`,
    `profile entries (flok-ui): ${evidence.profileEntriesUi.join(",") || "(none)"}`,
    `home fallback entries: ${evidence.homeFallbackEntries.join(",") || "(none)"}`,
    `windows: ${evidence.visibleWindows.join(" | ") || "(none)"}`,
    "chrome cmdlines:",
    evidence.chromeCmdlines.length ? evidence.chromeCmdlines.map((c) => `  ${c}`).join("\n") : "  (none)",
    "chrome log tail:",
    evidence.chromeLogTail.trim() ? evidence.chromeLogTail.trim() : "  (empty)",
  ];
  return lines.join("\n");
}

/**
 * Guest probe: one argv python3 -c. No secrets. Prints JSON on stdout.
 * Lists the profile as root and as flok-ui so a mount-namespace split is visible.
 */
export const CHROME_READY_PROBE_PY = [
  "import json,os,subprocess,pathlib",
  "UID=1500",
  "USER='flok-ui'",
  "PROFILE='/home/user/flok/.browser/profile'",
  "BROWSER='/home/user/flok/.browser'",
  "WS='/home/user/flok'",
  "LOG='/tmp/flok-chrome.log'",
  "FALLBACK='/home/flok-ui/.config/google-chrome'",
  "DISPLAY=':99'",
  "def listdir(p):",
  "    try: return sorted(os.listdir(p))",
  "    except Exception: return []",
  "def mode_of(p):",
  "    try:",
  "        st=os.stat(p)",
  "        return st.st_uid, st.st_gid, format(st.st_mode & 0o7777, 'o')",
  "    except Exception:",
  "        return None, None, None",
  "def pgrep(pat):",
  "    try:",
  "        r=subprocess.run(['pgrep','-u',USER,'-af',pat],capture_output=True,text=True)",
  "        return [ln for ln in (r.stdout or '').splitlines() if ln.strip() and 'pgrep' not in ln]",
  "    except Exception:",
  "        return []",
  "def alive(pat):",
  "    try:",
  "        r=subprocess.run(['pgrep','-u',USER,'-f',pat],capture_output=True)",
  "        return r.returncode==0",
  "    except Exception:",
  "        return False",
  "def runuser_ls(p):",
  "    try:",
  "        r=subprocess.run(['runuser','-u',USER,'--','ls','-1',p],capture_output=True,text=True)",
  "        if r.returncode!=0: return []",
  "        return [ln for ln in (r.stdout or '').splitlines() if ln.strip()]",
  "    except Exception:",
  "        return []",
  "def writable(p):",
  "    try:",
  "        r=subprocess.run(['runuser','-u',USER,'--','test','-w',p])",
  "        return r.returncode==0",
  "    except Exception:",
  "        return False",
  "def windows():",
  "    out=[]",
  "    cmds=[",
  "      ['runuser','-u',USER,'--','env',f'DISPLAY={DISPLAY}','xlsclients','-display',DISPLAY],",
  "      ['runuser','-u',USER,'--','env',f'DISPLAY={DISPLAY}','xdotool','search','--onlyvisible','--class','Google-chrome'],",
  "    ]",
  "    for argv in cmds:",
  "        try:",
  "            r=subprocess.run(argv,capture_output=True,text=True,timeout=2)",
  "        except Exception:",
  "            continue",
  "        for ln in (r.stdout or '').splitlines():",
  "            s=ln.strip()",
  "            if not s: continue",
  "            low=s.lower()",
  "            if 'xlsclients' in argv and ('chrome' not in low and 'chromium' not in low): continue",
  "            if s not in out: out.append(s)",
  "    return out",
  "def sandbox():",
  "    path=None",
  "    for cand in ('/opt/google/chrome/chrome-sandbox','/opt/google/chrome-sandbox'):",
  "        if os.path.isfile(cand): path=cand; break",
  "    if not path:",
  "        for root,dirs,files in os.walk('/opt/google'):",
  "            if 'chrome-sandbox' in files:",
  "                path=os.path.join(root,'chrome-sandbox'); break",
  "    if not path: return None,None,None",
  "    st=os.stat(path)",
  "    nosuid=None",
  "    try:",
  "        m=subprocess.run(['findmnt','-no','OPTIONS','-T',path],capture_output=True,text=True,timeout=2)",
  "        nosuid='nosuid' in (m.stdout or '')",
  "    except Exception:",
  "        pass",
  "    return path, format(st.st_mode & 0o7777, 'o'), nosuid",
  "def userns():",
  "    try: return pathlib.Path('/proc/sys/kernel/unprivileged_userns_clone').read_text().strip()",
  "    except Exception: return None",
  "cmd=pgrep('google-chrome')+pgrep('--user-data-dir=/home/user/flok/.browser/profile')",
  "seen=set(); cmdlines=[]",
  "for ln in cmd:",
  "    if ln not in seen: seen.add(ln); cmdlines.append(ln)",
  "pu,pg,pm=mode_of(PROFILE)",
  "_,_,bm=mode_of(BROWSER)",
  "_,_,wm=mode_of(WS)",
  "sp,sm,sn=sandbox()",
  "try: log=pathlib.Path(LOG).read_bytes()[-4096:].decode('utf-8','replace')",
  "except Exception: log=''",
  "low=log.lower()",
  "sand_err=any(s in low for s in ['suid sandbox','chrome-sandbox','new namespace','operation not permitted','zygote_host','no_sandbox','namespace sandbox'])",
  "out={",
  " 'chromeCmdlines':cmdlines,",
  " 'profileEntries':listdir(PROFILE),",
  " 'profileEntriesUi':runuser_ls(PROFILE),",
  " 'profileUid':pu,'profileGid':pg,'profileMode':pm,",
  " 'profileWritableByUi':writable(PROFILE),",
  " 'browserDirMode':bm,'workspaceMode':wm,",
  " 'sandboxPath':sp,'sandboxMode':sm,'sandboxNosuid':sn,",
  " 'xvfbAlive':alive('Xvfb'),'openboxAlive':alive('openbox'),",
  " 'display':DISPLAY,",
  " 'visibleWindows':windows(),",
  " 'homeFallbackEntries':listdir(FALLBACK),",
  " 'chromeLogTail':log,",
  " 'logHasSandboxError':sand_err,",
  " 'logHasChromeOutput':bool(log.strip()),",
  " 'unprivilegedUserns':userns(),",
  "}",
  "print(json.dumps(out))",
].join("\n");

/**
 * Guest-side stack starter. Written onto the Devbox at ensure time.
 * If Xvfb is absent (generic C3A Ubuntu Blueprint) this exits 0 so compute
 * provision/resume still succeed. observe/act then fail on screenshot/input.
 * Graphical processes run as flok-ui; refuse to start Chrome as root.
 */
export const ENSURE_INTERACTIVE_SH = `#!/bin/bash
set -euo pipefail
export DISPLAY="\${FLOK_DISPLAY:-:99}"
WIDTH="\${FLOK_DISPLAY_WIDTH:-1440}"
HEIGHT="\${FLOK_DISPLAY_HEIGHT:-900}"
DEPTH="\${FLOK_DISPLAY_DEPTH:-24}"
PROFILE="\${FLOK_BROWSER_PROFILE:-/home/user/flok/.browser/profile}"
RUNDIR="/tmp/flok-interactive"
NOVNC_PORT="\${FLOK_NOVNC_PORT:-6080}"
UI_USER="\${FLOK_UI_USER:-${FLOK_UI_USER}}"
UI_HOME="\${FLOK_UI_HOME:-${FLOK_UI_HOME}}"
UI_UID="\${FLOK_UI_UID:-${FLOK_UI_UID}}"
XDG_RUNTIME_DIR="/run/user/\${UI_UID}"

mkdir -p "$RUNDIR" "$PROFILE" /home/user/flok/.flok /home/user/flok/.browser

if ! command -v Xvfb >/dev/null 2>&1; then
  echo "ok missing-xvfb profile=$PROFILE"
  exit 0
fi

if ! id -u "$UI_USER" >/dev/null 2>&1; then
  echo "flok-ui user missing; refuse to start Chrome as root" >&2
  exit 1
fi
if ! command -v runuser >/dev/null 2>&1; then
  echo "runuser missing; refuse to start graphical stack as root" >&2
  exit 1
fi

mkdir -p "$XDG_RUNTIME_DIR" /tmp/.X11-unix
chown "$UI_USER:$UI_USER" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
chmod 1777 /tmp/.X11-unix || true
chown "$UI_USER:$UI_USER" "$RUNDIR" || true
# Root-executed helpers live in .flok; never hand that directory to flok-ui.
chown root:root /home/user/flok/.flok
chmod 755 /home/user/flok/.flok
if [ -f /home/user/flok/.flok/execvp.py ]; then
  chown root:root /home/user/flok/.flok/execvp.py
  chmod 755 /home/user/flok/.flok/execvp.py
fi
if [ -f /home/user/flok/.flok/ensure-interactive.sh ]; then
  chown root:root /home/user/flok/.flok/ensure-interactive.sh
  chmod 755 /home/user/flok/.flok/ensure-interactive.sh
fi
if [ -f /home/user/flok/.flok/fixture.html ]; then
  chown root:root /home/user/flok/.flok/fixture.html
  chmod 644 /home/user/flok/.flok/fixture.html
fi
if [ -f /home/user/flok/.flok/cdp-ax.mjs ]; then
  chown root:root /home/user/flok/.flok/cdp-ax.mjs
  chmod 755 /home/user/flok/.flok/cdp-ax.mjs
fi
chown -R "$UI_USER:$UI_USER" /home/user/flok/.browser
chmod 700 /home/user/flok/.browser
chmod 700 "$PROFILE" || true
chmod 775 /home/user/flok || true
if [ -L /tmp/flok-chrome.log ] || { [ -e /tmp/flok-chrome.log ] && [ ! -f /tmp/flok-chrome.log ]; }; then
  echo "refusing to use /tmp/flok-chrome.log: not a regular file" >&2
  ls -ld /tmp/flok-chrome.log >&2
  exit 1
fi
touch /tmp/flok-chrome.log
if [ -L /tmp/flok-chrome.log ]; then
  echo "refusing to use /tmp/flok-chrome.log: not a regular file" >&2
  exit 1
fi
chown --no-dereference "$UI_USER:$UI_USER" /tmp/flok-chrome.log
chmod 640 /tmp/flok-chrome.log
if ! runuser -u "$UI_USER" -- test -w "$PROFILE"; then
  echo "profile not writable by $UI_USER: $PROFILE" >&2
  ls -ld "$PROFILE" /home/user/flok/.browser /home/user/flok >&2
  exit 1
fi

alive() {
  local pf="$1"
  if [ -f "$pf" ]; then
    local pid
    pid="$(cat "$pf")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

start_ui() {
  local name="$1"
  shift
  local pidfile="$RUNDIR/\${name}.pid"
  local logfile="/tmp/flok-\${name}.log"
  local pid
  pid="\$(
    runuser -u "$UI_USER" -- env \\
      DISPLAY="$DISPLAY" \\
      HOME="$UI_HOME" \\
      XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \\
      sh -c 'log="$1"; shift; nohup "$@" >>"$log" 2>&1 & echo $!' sh "$logfile" "$@"
  )"
  echo "$pid" > "$pidfile"
}

# Suspend kills Chrome but leaves SingletonLock on disk.
if ! pgrep -u "$UI_USER" -f -- "--user-data-dir=\${PROFILE}" >/dev/null 2>&1; then
  rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie"
fi

if ! alive "$RUNDIR/xvfb.pid"; then
  rm -f /tmp/.X11-unix/X99 /tmp/.X99-lock
  start_ui xvfb Xvfb "$DISPLAY" -screen 0 "\${WIDTH}x\${HEIGHT}x\${DEPTH}" -nolisten tcp
  sleep 0.4
fi
if ! alive "$RUNDIR/openbox.pid"; then
  start_ui openbox openbox
fi
if command -v x11vnc >/dev/null 2>&1 && ! alive "$RUNDIR/x11vnc.pid"; then
  start_ui x11vnc x11vnc -display "$DISPLAY" -localhost -nopw -forever -shared -rfbport 5900
fi
if command -v websockify >/dev/null 2>&1 && ! alive "$RUNDIR/novnc.pid"; then
  WEB=""
  for d in /usr/share/novnc /usr/share/novnc/utils; do
    if [ -d "$d" ]; then WEB="$d"; break; fi
  done
  if [ -n "$WEB" ]; then
    start_ui novnc websockify --web "$WEB" "127.0.0.1:\${NOVNC_PORT}" 127.0.0.1:5900
  fi
fi
echo "ok display=$DISPLAY profile=$PROFILE ui=$UI_USER"
`;

export const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>FLOKS C3B fixture</title>
  <style>
    html, body { margin: 0; width: 1440px; height: 900px; background: #102a43; color: #fff; font: 24px sans-serif; }
    #target { position: absolute; left: 160px; top: 80px; width: 400px; height: 200px; background: #2cb1bc; }
    #out { position: absolute; left: 160px; top: 300px; }
  </style>
</head>
<body>
  <div id="target">click-me</div>
  <div id="out">idle</div>
  <script>
    document.getElementById('target').addEventListener('click', function () {
      document.getElementById('out').textContent = 'clicked';
    });
    document.addEventListener('keydown', function (e) {
      document.getElementById('out').textContent = 'key:' + e.key;
    });
  </script>
</body>
</html>
`;
