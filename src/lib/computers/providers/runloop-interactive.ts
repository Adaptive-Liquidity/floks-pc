/**
 * C3B interactive-computer helpers.
 * Pure validation + constants. No network.
 *
 * Suspend preserves disk, not RAM. Graphical daemons and Chromium must be
 * restarted after resume via ensureInteractiveStack().
 */

import { posix as pathPosix } from "node:path";
import type { Action } from "../types.js";
import { RUNLOOP_WORKSPACE_ROOT } from "./runloop-client.js";

export const FLOK_DISPLAY = ":99";
export const DISPLAY_WIDTH = 1440;
export const DISPLAY_HEIGHT = 900;
export const DISPLAY_DEPTH = 24;
export const BROWSER_PROFILE_DIR = `${RUNLOOP_WORKSPACE_ROOT}/.browser/profile`;
export const INTERACTIVE_DIR = `${RUNLOOP_WORKSPACE_ROOT}/.flok`;
export const FIXTURE_PATH = `${INTERACTIVE_DIR}/fixture.html`;
export const OBS_SHOT_PATH = `${INTERACTIVE_DIR}/obs.png`;
export const ENSURE_SCRIPT_PATH = `${INTERACTIVE_DIR}/ensure-interactive.sh`;
export const LOCAL_NOVNC_URL = "http://127.0.0.1:6080/";
export const MAX_TYPE_CHARS = 2000;
export const MAX_WAIT_MS = 10_000;
export const DEFAULT_INTERACTIVE_BLUEPRINT = "flok-runloop-interactive";

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
      if (typeof action.y !== "number" && typeof action.x !== "number") {
        return "scroll requires x or y delta";
      }
      if (action.x !== undefined && !Number.isFinite(action.x)) return "scroll x must be finite";
      if (action.y !== undefined && !Number.isFinite(action.y)) return "scroll y must be finite";
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

/**
 * Guest-side stack starter. Written onto the Devbox at ensure time.
 * If Xvfb is absent (generic C3A Ubuntu Blueprint) this exits 0 so compute
 * provision/resume still succeed. observe/act then fail on screenshot/input.
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
mkdir -p "$RUNDIR" "$PROFILE" /home/user/flok/.flok /home/user/flok/.browser

if ! command -v Xvfb >/dev/null 2>&1; then
  echo "ok missing-xvfb profile=$PROFILE"
  exit 0
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

# Suspend kills Chrome but leaves SingletonLock on disk.
if ! pgrep -f -- "--user-data-dir=\${PROFILE}" >/dev/null 2>&1; then
  rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie"
fi

if ! alive "$RUNDIR/xvfb.pid"; then
  Xvfb "$DISPLAY" -screen 0 "\${WIDTH}x\${HEIGHT}x\${DEPTH}" -nolisten tcp >/tmp/flok-xvfb.log 2>&1 &
  echo $! > "$RUNDIR/xvfb.pid"
  sleep 0.4
fi
if ! alive "$RUNDIR/openbox.pid"; then
  DISPLAY="$DISPLAY" openbox >/tmp/flok-openbox.log 2>&1 &
  echo $! > "$RUNDIR/openbox.pid"
fi
if command -v x11vnc >/dev/null 2>&1 && ! alive "$RUNDIR/x11vnc.pid"; then
  x11vnc -display "$DISPLAY" -localhost -nopw -forever -shared -rfbport 5900 >/tmp/flok-x11vnc.log 2>&1 &
  echo $! > "$RUNDIR/x11vnc.pid"
fi
if command -v websockify >/dev/null 2>&1 && ! alive "$RUNDIR/novnc.pid"; then
  WEB=""
  for d in /usr/share/novnc /usr/share/novnc/utils; do
    if [ -d "$d" ]; then WEB="$d"; break; fi
  done
  if [ -n "$WEB" ]; then
    websockify --web "$WEB" "127.0.0.1:\${NOVNC_PORT}" 127.0.0.1:5900 >/tmp/flok-novnc.log 2>&1 &
    echo $! > "$RUNDIR/novnc.pid"
  fi
fi
echo "ok display=$DISPLAY profile=$PROFILE"
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
