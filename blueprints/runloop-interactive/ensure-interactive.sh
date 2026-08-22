#!/bin/bash
# Idempotent graphical stack for a FLOKS Node Devbox.
# Display :99, Openbox, localhost x11vnc, localhost noVNC — all as flok-ui.
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
UI_USER="${FLOK_UI_USER:-flok-ui}"
UI_HOME="${FLOK_UI_HOME:-/home/flok-ui}"
UI_UID="${FLOK_UI_UID:-1500}"
XDG_RUNTIME_DIR="/run/user/${UI_UID}"

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
chown -R "$UI_USER:$UI_USER" /home/user/flok/.browser /home/user/flok/.flok
chmod 700 /home/user/flok/.browser
chmod 775 /home/user/flok/.flok /home/user/flok || true

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
  local pidfile="$RUNDIR/${name}.pid"
  local logfile="/tmp/flok-${name}.log"
  local pid
  pid="$(
    runuser -u "$UI_USER" -- env \
      DISPLAY="$DISPLAY" \
      HOME="$UI_HOME" \
      XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
      sh -c 'log="$1"; shift; nohup "$@" >>"$log" 2>&1 & echo $!' sh "$logfile" "$@"
  )"
  echo "$pid" > "$pidfile"
}

# Suspend kills Chrome but leaves SingletonLock on disk.
if ! pgrep -u "$UI_USER" -f -- "--user-data-dir=${PROFILE}" >/dev/null 2>&1; then
  rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie"
fi

if ! alive "$RUNDIR/xvfb.pid"; then
  rm -f /tmp/.X11-unix/X99 /tmp/.X99-lock
  start_ui xvfb Xvfb "$DISPLAY" -screen 0 "${WIDTH}x${HEIGHT}x${DEPTH}" -nolisten tcp
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
    start_ui novnc websockify --web "$WEB" "127.0.0.1:${NOVNC_PORT}" 127.0.0.1:5900
  fi
fi
echo "ok display=$DISPLAY profile=$PROFILE ui=$UI_USER"
