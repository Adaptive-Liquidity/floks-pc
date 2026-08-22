#!/bin/bash
# Idempotent graphical stack for a FLOKS Node Devbox.
# Display :99, Openbox, localhost x11vnc, localhost noVNC.
# Does not survive Runloop suspend — call again after resume.
# If Xvfb is not installed (generic C3A Ubuntu Blueprint), exit 0 so
# compute-only provision/resume still works.
set -euo pipefail
export DISPLAY="${FLOK_DISPLAY:-:99}"
WIDTH="${FLOK_DISPLAY_WIDTH:-1440}"
HEIGHT="${FLOK_DISPLAY_HEIGHT:-900}"
DEPTH="${FLOK_DISPLAY_DEPTH:-24}"
PROFILE="${FLOK_BROWSER_PROFILE:-/home/user/flok/.browser/profile}"
RUNDIR="/tmp/flok-interactive"
NOVNC_PORT="${FLOK_NOVNC_PORT:-6080}"
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
if ! pgrep -f -- "--user-data-dir=${PROFILE}" >/dev/null 2>&1; then
  rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie"
fi

if ! alive "$RUNDIR/xvfb.pid"; then
  Xvfb "$DISPLAY" -screen 0 "${WIDTH}x${HEIGHT}x${DEPTH}" -nolisten tcp >/tmp/flok-xvfb.log 2>&1 &
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
    websockify --web "$WEB" "127.0.0.1:${NOVNC_PORT}" 127.0.0.1:5900 >/tmp/flok-novnc.log 2>&1 &
    echo $! > "$RUNDIR/novnc.pid"
  fi
fi
echo "ok display=$DISPLAY profile=$PROFILE"
